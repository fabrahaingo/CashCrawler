/**
 * Transaction extraction for Caisse d'Épargne (PFM API)
 *
 * Uses the PFM (Personal Finance Management) API to fetch transactions.
 * This replaces the old CSV download approach — a single GET call returns
 * all transactions (~2 years) with rich metadata:
 *
 * - Counterparty info (name, IBAN, BIC, bank)
 * - Auto-categorization (categoryId, detectedCategories)
 * - Parsed labels (label2, label3, originalText)
 * - Transaction type/subtype codes
 * - Client account details
 *
 * The PFM account IDs are extracted from the augmentedSynthesisViews
 * response (the _links.accountSynthesisView field).
 */

import fs from "fs";
import path from "path";
import { Page } from "playwright";
import { ORIGIN, API } from "./config";
import { BANK_IDS } from "../../lib/types";
import {
  getTodayDate,
  getAccountDir,
  saveTransactionsCSV,
  hasTransactionsForToday,
} from "../../lib/storage";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

interface PfmAccount {
  /** PFM account ID (from _links.accountSynthesisView URL) */
  pfmAccountId: string;
  /** Display name (e.g., "Compte individuel", "Livret A") */
  accountName: string;
}

interface PfmTransaction {
  id: number;
  amount: number;
  currency: string;
  text: string;
  categoryId: number | null;
  date: string;
  dueDate: string;
  originalDate: string;
  accountId: number;
  merchantId: number | null;
  isFlagged: boolean | null;
  counterpartyAccountIdentifier: string;
  detectedCategories: Array<{ categoryId: number; score: number }>;
  parsedData: Record<string, string>;
}

// =============================================================================
// CSV FORMAT
// =============================================================================

/**
 * CSV header with all PFM fields.
 *
 * The rich PFM data includes counterparty banking details, auto-categories,
 * and parsed transaction labels that are valuable for financial analysis.
 */
const CSV_HEADER = [
  "date",
  "amount",
  "currency",
  "text",
  "category_id",
  "counterparty",
  "counterparty_iban",
  "counterparty_bic",
  "counterparty_bank",
  "type_code",
  "subtype_code",
  "status",
  "label2",
  "label3",
  "original_text",
  "accounting_date",
  "merchant_id",
  "transaction_id",
].join(";");

/**
 * Converts a PFM transaction to a CSV line.
 * Escapes semicolons in text fields to avoid breaking the CSV.
 */
function transactionToCsvLine(tx: PfmTransaction): string {
  const d = new Date(tx.date);
  const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const pd = tx.parsedData ?? {};
  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/;/g, ",").replace(/\n/g, " ");

  return [
    dateStr,
    tx.amount?.toFixed(2) ?? "0.00",
    tx.currency ?? "EUR",
    esc(tx.text),
    tx.categoryId ?? "",
    esc(pd.counterpartyLabel),
    esc(pd.counterpartyIBAN),
    esc(pd.counterpartyBIC),
    esc(pd.counterpartyBank),
    pd.transactionTypeCode ?? "",
    pd.transactionSubtypeCode ?? "",
    pd.status ?? "",
    esc(pd.label2),
    esc(pd.label3),
    esc(pd.originalText),
    pd.accountingDate ?? "",
    tx.merchantId ?? "",
    tx.id ?? "",
  ].join(";");
}

// =============================================================================
// ACCOUNT EXTRACTION
// =============================================================================

/**
 * Extracts PFM account IDs from the augmentedSynthesisViews response.
 *
 * Each account item has _links.accountSynthesisView with a URL like:
 *   .../pfm/user/v1.1/transactions?accountIds=123456
 *
 * We extract the accountIds parameter as the PFM account ID.
 */
function extractPfmAccounts(apiData: any): PfmAccount[] {
  const items = apiData?.items ?? [];
  const accounts: PfmAccount[] = [];

  for (const item of items) {
    const href = item?._links?.accountSynthesisView?.href;
    if (!href) continue;

    const match = href.match(/accountIds=(\d+)/);
    if (!match) continue;

    const accountName =
      item.identity?.contractLabel ?? `Account ${match[1]}`;

    accounts.push({
      pfmAccountId: match[1],
      accountName,
    });
  }

  return accounts;
}

// =============================================================================
// PFM API
// =============================================================================

/**
 * Fetches all transactions for an account via the PFM API.
 *
 * The API returns all available history (~792 days) in a single call.
 * No pagination needed — the response includes a totalCount in meta.
 */
async function fetchPfmTransactions(
  page: Page,
  authToken: string,
  pfmAccountId: string,
  accountName: string,
): Promise<PfmTransaction[]> {
  const spinner = createSpinner(
    `Fetching transactions for ${accountName}...`
  );
  spinner.start();

  try {
    const url = API.pfmTransactions(pfmAccountId);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    const response = await page.context().request.get(url, {
      headers: {
        Authorization: authToken,
        Accept: "application/json, text/plain, */*",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        "User-Agent": userAgent,
      },
    });

    if (!response.ok()) {
      spinner.stop();
      console.log(
        `  ⚠️ ${accountName}: PFM API returned ${response.status()}`
      );
      return [];
    }

    const data = await response.json();
    const transactions: PfmTransaction[] = data.data ?? [];
    const total = data.meta?.totalCount ?? transactions.length;

    spinner.stop(
      `  ✓ ${accountName}: ${transactions.length} transactions (total: ${total})`
    );
    return transactions;
  } catch (error) {
    spinner.stop();
    console.log(
      `  ⚠️ ${accountName}: ${error instanceof Error ? error.message : error}`
    );
    return [];
  }
}

// =============================================================================
// PENDING CARD OPERATIONS
// =============================================================================

/** One pending card operation, as written to pending.json */
export interface PendingOperation {
  /** Operation date (YYYY-MM-DD), the date shown by the bank */
  date: string;
  amount: number;
  text: string;
  originalText: string;
  categoryId: number | null;
  /** Bank reference of the pending operation (not reused once booked) */
  reference: string;
  typeCode: string;
}

/**
 * Fetches the pending card operations of an account ("Opérations carte en
 * cours"). Returns null when the call fails, so the caller can keep the
 * previous snapshot instead of wiping it.
 */
async function fetchPendingOperations(
  page: Page,
  authToken: string,
  pfmAccountId: string,
): Promise<PendingOperation[] | null> {
  try {
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const response = await page.context().request.get(
      API.pfmPendingTransactions(pfmAccountId),
      {
        headers: {
          Authorization: authToken,
          Accept: "application/json, text/plain, */*",
          Origin: ORIGIN,
          Referer: `${ORIGIN}/`,
          "User-Agent": userAgent,
        },
      }
    );
    if (!response.ok()) return null;
    const data = await response.json();
    const transactions: PfmTransaction[] = data.data ?? [];
    return transactions
      // The filter is applied server-side; double-check the status anyway
      .filter((tx) => (tx.parsedData?.status ?? "WD") === "WD")
      .map((tx) => ({
        date: (tx.originalDate ?? tx.date).slice(0, 10),
        amount: tx.amount,
        text: tx.text ?? "",
        originalText: tx.parsedData?.originalText ?? "",
        categoryId: tx.categoryId,
        reference: tx.parsedData?.transactionReference ?? String(tx.id),
        typeCode: tx.parsedData?.transactionTypeCode ?? "",
      }));
  } catch {
    return null;
  }
}

/**
 * Writes the pending snapshot next to the account's history CSV. Always
 * rewritten (even empty) so operations that got booked or cancelled
 * disappear on the next import. JSON, not CSV: the storage module treats any
 * .csv in the folder as the history file.
 */
function savePendingOperations(accountName: string, operations: PendingOperation[]): string {
  const dir = getAccountDir(BANK_IDS.CAISSE_EPARGNE, accountName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pending.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ fetchedAt: new Date().toISOString(), operations }, null, 2)
  );
  return file;
}

async function refreshPendingOperations(
  page: Page,
  authToken: string,
  accounts: PfmAccount[],
): Promise<void> {
  for (const account of accounts) {
    const operations = await fetchPendingOperations(page, authToken, account.pfmAccountId);
    if (operations === null) {
      console.log(`  ⚠️ ${account.accountName}: pending operations unavailable (kept previous snapshot)`);
      continue;
    }
    savePendingOperations(account.accountName, operations);
    if (operations.length > 0) {
      console.log(`  ⏳ ${account.accountName}: ${operations.length} pending card operation(s)`);
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

/**
 * Downloads transactions for all accounts using the PFM API.
 *
 * For each account with a PFM link:
 *   1. Fetches all transactions via a single GET call
 *   2. Converts to rich CSV format with all PFM metadata
 *   3. Saves using the standard storage module (with merge/dedup)
 *
 * @param page Playwright page (used for API context)
 * @param apiData augmentedSynthesisViews response (contains PFM account IDs)
 * @param authToken Bearer token for API calls
 * @returns true if transactions were downloaded
 */
export async function downloadTransactions(
  page: Page,
  apiData: any,
  authToken: string,
): Promise<boolean> {
  const accounts = extractPfmAccounts(apiData);

  if (accounts.length === 0) {
    console.log("⚠️ No accounts with PFM links found");
    return false;
  }

  const accountNames = accounts.map((a) => a.accountName);

  // Pending operations change during the day: refresh them on every run,
  // before the "already downloaded today" guard
  await refreshPendingOperations(page, authToken, accounts);

  // Guard: Check if already downloaded today
  if (hasTransactionsForToday(BANK_IDS.CAISSE_EPARGNE, accountNames)) {
    console.log("✅ Transactions already downloaded today. Nothing to do!");
    return false;
  }

  console.log(`Found ${accounts.length} account(s) with PFM data`);

  let downloadedCount = 0;

  for (const account of accounts) {
    const transactions = await fetchPfmTransactions(
      page,
      authToken,
      account.pfmAccountId,
      account.accountName,
    );

    if (transactions.length === 0) continue;

    // Sort by date descending (newest first) — usually already sorted
    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Build CSV content
    const csvLines = [CSV_HEADER];
    for (const tx of transactions) {
      csvLines.push(transactionToCsvLine(tx));
    }
    const csvContent = csvLines.join("\n");

    // Find earliest date for filename
    const oldest = transactions[transactions.length - 1];
    const oldestDate = new Date(oldest.date);
    const startDate = oldestDate.toISOString().split("T")[0];

    const savedPath = saveTransactionsCSV(
      BANK_IDS.CAISSE_EPARGNE,
      account.accountName,
      startDate,
      csvContent,
    );
    console.log(`  💾 Saved: ${savedPath}`);
    downloadedCount++;
  }

  console.log(
    `\n📊 Downloaded transactions for ${downloadedCount}/${accounts.length} account(s)`
  );
  return downloadedCount > 0;
}
