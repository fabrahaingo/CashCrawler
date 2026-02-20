/**
 * Transaction extraction for Bourse Direct
 *
 * Two data sources, merged and deduplicated:
 *
 * 1. **Historique de compte** (`historique-de-compte.php`)
 *    Clean HTML table inside a legacy iframe. Shows recent transactions
 *    (~3 months, no pagination). Columns: Date opération, Date affectation,
 *    Libellé, Opération, Qté, Cours, Montant net.
 *
 * 2. **Relevés mensuels** (`releveCompte.php`)
 *    Monthly account statements going back 13 months. Messy legacy HTML
 *    with parallel nested tables for dates, descriptions, and amounts.
 *    Parsed per-month, one HTTP request per month.
 *
 * Both sources are normalized into a common Transaction format, merged,
 * deduplicated, and saved as semicolon-separated CSV.
 */

import { Page, Frame, BrowserContext } from "playwright";
import {
  HISTORIQUE_URL,
  SELECTORS,
  getReleveCompteUrl,
} from "./config";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

export interface Transaction {
  /** Operation date in DD/MM/YYYY format */
  date: string;
  /** Security name or description (e.g., "DASSAULT SYSTEMES", empty for transfers) */
  label: string;
  /** Operation type (e.g., "ACHAT COMPTANT", "VENTE COMPTANT", "TAXE", "FRAIS") */
  operation: string;
  /** Signed quantity (positive=buy, negative=sell, empty for fees/transfers) */
  quantity: string;
  /** Unit price (empty for fees/transfers) */
  price: string;
  /** Signed net amount (negative=debit, positive=credit) */
  netAmount: number;
}

/** Account info extracted from the dropdown */
export interface AccountInfo {
  /** The dropdown option value (e.g., "1") */
  nc: string;
  /** The account display name (e.g., "Compte Titre ordinaire") */
  name: string;
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

/**
 * Parses a French-formatted number string.
 * e.g., "1 234,56 €" → 1234.56, "-3,96 €" → -3.96
 */
function parseFrenchNumber(text: string): number {
  const cleaned = text
    .replace(/[€\s\u00a0]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return parseFloat(cleaned);
}

/**
 * Extracts the account type from a dropdown option text.
 * "508TI...EUR MR NAME (Compte Titre ordinaire)" → "Compte Titre ordinaire"
 */
function extractAccountName(optionText: string): string {
  const match = optionText.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : optionText.trim();
}

/**
 * Accesses the legacy iframe on the current page.
 * Returns the Frame, or throws if not found.
 */
async function getLegacyFrame(page: Page): Promise<Frame> {
  await page.waitForSelector(SELECTORS.legacyIframe, { timeout: 15000 });
  const iframeElement = await page.$(SELECTORS.legacyIframe);
  if (!iframeElement) {
    throw new Error("Could not find legacy iframe");
  }
  const frame = await iframeElement.contentFrame();
  if (!frame) {
    throw new Error("Could not access legacy iframe content");
  }
  return frame;
}

/**
 * Reads all accounts from the dropdown in the iframe.
 */
async function getAccounts(frame: Frame): Promise<AccountInfo[]> {
  await frame.waitForSelector(SELECTORS.accountSelect, { timeout: 10000 });
  const options = await frame.$$(`${SELECTORS.accountSelect} option`);
  const accounts: AccountInfo[] = [];
  for (const opt of options) {
    const value = (await opt.getAttribute("value")) ?? "";
    const text = (await opt.innerText()).trim();
    accounts.push({ nc: value, name: extractAccountName(text) });
  }
  return accounts;
}

/**
 * Formats a Transaction as a CSV line (semicolon-separated).
 */
function transactionToCsvLine(tx: Transaction): string {
  return [
    tx.date,
    tx.label,
    tx.operation,
    tx.quantity,
    tx.price,
    tx.netAmount.toFixed(2),
  ].join(";");
}

/**
 * Generates a deduplication key for a transaction.
 * Uses date + netAmount + first 15 chars of label to identify duplicates.
 *
 * The label is truncated because the historique and relevé sources
 * sometimes show different truncations of the same security name
 * (e.g., "SOITEC REGROUPEMENT SOITEC REGROUPEM." vs "SOITEC REGROUPEM.").
 */
function deduplicationKey(tx: Transaction): string {
  const shortLabel = tx.label.slice(0, 15).trim();
  return `${tx.date}|${shortLabel}|${tx.netAmount.toFixed(2)}`;
}

// =============================================================================
// CSV HEADER
// =============================================================================

const CSV_HEADER = "date;label;operation;quantity;price;net_amount";

// =============================================================================
// SOURCE 1: HISTORIQUE DE COMPTE (clean table, recent ~3 months)
// =============================================================================

/**
 * Scrapes transactions from the historique-de-compte page.
 *
 * The page contains a legacy iframe with a table (table.datas.retour).
 * Each row has 7 <td> cells:
 *   0: Date opération (DD/MM/YYYY)
 *   1: Date affectation (DD/MM/YYYY) — ignored
 *   2: Libellé (security name, may contain <a> link)
 *   3: Opération (ACHAT COMPTANT, VENTE COMPTANT, etc.)
 *   4: Qté (signed integer, or "--")
 *   5: Cours (price with €, or "--")
 *   6: Montant net (signed amount with €)
 *
 * TTF rows have empty Opération and "--" for Qté/Cours.
 * The last row is an empty spacer (colspan).
 */
export async function scrapeHistorique(page: Page): Promise<Transaction[]> {
  const spinner = createSpinner("Loading account history...");
  spinner.start();

  await page.goto(HISTORIQUE_URL, { waitUntil: "domcontentloaded" });
  const frame = await getLegacyFrame(page);
  await frame.waitForSelector(SELECTORS.historiqueTable, {
    state: "visible",
    timeout: 15000,
  });

  spinner.stop("📊 Account history loaded");

  const transactions: Transaction[] = [];
  const rows = await frame.$$(`${SELECTORS.historiqueTable} tr`);

  for (const row of rows) {
    const cells = await row.$$("td");
    if (cells.length < 7) continue; // skip header and spacer rows

    const dateOp = (await cells[0].innerText()).trim();
    // Skip rows without a valid date (spacer rows, etc.)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateOp)) continue;

    const label = (await cells[2].innerText()).trim();
    let operation = (await cells[3].innerText()).trim();
    const qtyText = (await cells[4].innerText()).trim();
    const priceText = (await cells[5].innerText()).trim();
    const amountText = (await cells[6].innerText()).trim();

    const netAmount = parseFrenchNumber(amountText);
    if (isNaN(netAmount)) continue;

    // Normalize TTF / fee rows: empty operation → derive from label
    if (!operation) {
      if (label.includes("TTF")) {
        operation = "TAXE";
      } else {
        operation = "FRAIS";
      }
    }

    // Normalize quantity and price ("--" → empty)
    const quantity = qtyText === "--" ? "" : qtyText.replace(/\s/g, "");
    const price =
      priceText === "--"
        ? ""
        : parseFrenchNumber(priceText).toString();

    transactions.push({
      date: dateOp,
      label,
      operation: operation.trim(),
      quantity,
      price,
      netAmount,
    });
  }

  console.log(`  Found ${transactions.length} transactions in historique`);
  return transactions;
}

// =============================================================================
// SOURCE 2: RELEVES MENSUELS (monthly statements, 13-month backfill)
// =============================================================================

/**
 * Computes the last calendar day of a month in YYYYMMDD format.
 */
function lastDayOfMonth(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return (
    String(year) +
    String(month).padStart(2, "0") +
    String(lastDay).padStart(2, "0")
  );
}

/**
 * Normalizes operation prefixes from relevé format to full names.
 *
 * Relevé format:        Normalized:
 *   ACH CPT           → ACHAT COMPTANT
 *   VTE CPT           → VENTE COMPTANT
 *   TAXE TRANSACT...  → TAXE
 *   FRAIS ...         → FRAIS (+ rest)
 *   VIRT EXTERNE EMIS → VIREMENT SORTANT
 *   COUPONS           → COUPONS
 *   OPERATION DIVERSE → OPERATION DIVERSE (+ rest)
 */
function normalizeReleveOperation(description: string): {
  label: string;
  operation: string;
} {
  const desc = description.trim();

  if (desc.startsWith("ACH CPT ")) {
    return { label: desc.slice(8).trim(), operation: "ACHAT COMPTANT" };
  }
  if (desc.startsWith("VTE CPT ")) {
    return { label: desc.slice(8).trim(), operation: "VENTE COMPTANT" };
  }
  if (desc.startsWith("TAXE TRANSACT")) {
    return { label: desc, operation: "TAXE" };
  }
  if (desc.startsWith("FRAIS ")) {
    return { label: "", operation: desc };
  }
  if (desc.startsWith("VIRT EXTERNE EMIS")) {
    return { label: "", operation: "VIREMENT SORTANT" };
  }
  if (desc.startsWith("COUPONS ")) {
    return { label: desc.slice(8).trim(), operation: "COUPONS" };
  }
  if (desc.startsWith("OPERATION DIVERSE ")) {
    return { label: "", operation: desc };
  }

  // Fallback: use the whole description as operation
  return { label: "", operation: desc };
}

/**
 * Parses a single monthly account statement (releveCompte.php).
 *
 * The HTML structure is a deeply nested table from ~2005:
 *
 * Main table has a row with 4 <td class="tableau"> cells:
 *   [0] Dates column — nested table with date rows
 *   [1] Descriptions column — nested table with description rows
 *   [2] Debit column — nested table with debit amounts
 *   [3] Credit column — nested table with credit amounts
 *
 * Each column's nested table has rows that align positionally:
 *   - Empty/spacer rows (containing &nbsp;)
 *   - "Solde au : DD/MM/YYYY" rows (opening/closing balance)
 *   - Transaction data rows
 *   - "Cumul mouvements" summary row
 *
 * We extract the text from each column's nested table, align them
 * positionally, and parse transaction rows.
 */
async function parseReleveCompte(
  context: BrowserContext,
  nc: string,
  dt: string,
  year: number,
  month: number
): Promise<Transaction[]> {
  const url = getReleveCompteUrl(nc, dt);
  const newPage = await context.newPage();

  try {
    await newPage.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await newPage.waitForTimeout(1000);

    // Check if the page has actual content
    const bodyText = await newPage.$eval(
      "body",
      (el) => (el as HTMLElement).innerText
    );
    if (!bodyText.includes("RELEVE DE COMPTE")) {
      return []; // No statement for this month
    }

    // Find the data columns. The page has 8 td.tableau cells:
    //   [0-3] Header cells: Date, Désignation, Débit (€), Crédit (€)
    //   [4-7] Data cells: each contains a nested <table> with row data
    const tableauCells = await newPage.$$("td.tableau");
    if (tableauCells.length < 8) {
      return []; // Unexpected structure
    }

    // Extract text rows from each of the 4 data column cells (indices 4-7)
    // Each cell contains a nested table; we extract text from each <tr>
    const extractColumnRows = async (
      cell: any
    ): Promise<string[]> => {
      const rows = await cell.$$("table tr");
      const texts: string[] = [];
      for (const row of rows) {
        const text = (await row.innerText()).trim();
        texts.push(text);
      }
      return texts;
    };

    const dateRows = await extractColumnRows(tableauCells[4]);
    const descRows = await extractColumnRows(tableauCells[5]);
    const debitRows = await extractColumnRows(tableauCells[6]);
    const creditRows = await extractColumnRows(tableauCells[7]);

    // The 4 columns have parallel rows that align positionally.
    // Row N in the date column corresponds to row N in the description,
    // debit, and credit columns. We iterate all rows, matching by index.
    //
    // A transaction row has:
    //   - A date (DD/MM/YYYY) in the date column
    //   - A description (e.g., "ACH CPT SOITEC...\tQté: 24\tCours: 40,6")
    //   - A debit and/or credit amount
    //
    // Non-transaction rows (Solde au, Cumul, spacers) are skipped.

    const transactions: Transaction[] = [];
    const maxRows = Math.max(
      dateRows.length,
      descRows.length,
      debitRows.length,
      creditRows.length
    );

    for (let i = 0; i < maxRows; i++) {
      const dateText = (dateRows[i] ?? "").trim();
      const descText = (descRows[i] ?? "").trim();
      const debitText = (debitRows[i] ?? "").trim();
      const creditText = (creditRows[i] ?? "").trim();

      // Must have a valid date
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) continue;

      // Skip Solde/Cumul rows
      if (descText.includes("Solde au")) continue;
      if (descText.includes("Cumul mouvements")) continue;
      if (!descText || descText === "\u00a0") continue;

      // Must have a debit or credit amount
      const debit = debitText ? parseFrenchNumber(debitText) : NaN;
      const credit = creditText ? parseFrenchNumber(creditText) : NaN;
      if ((isNaN(debit) || debit === 0) && (isNaN(credit) || credit === 0)) {
        continue;
      }

      // Parse the description — contains operation + quantity + price
      // Format: "ACH CPT VUSIONGROUP\tQté :  20\tCours :  134,4"
      const qtyMatch = descText.match(/Qté\s*:\s*([-\d\s,]+)/);
      const coursMatch = descText.match(/Cours\s*:\s*([\d\s,]+)/);

      // The operation name is everything before the first tab or "Qté"
      let opPart = descText;
      const tabIdx = descText.indexOf("\t");
      if (tabIdx > 0) {
        opPart = descText.slice(0, tabIdx).trim();
      } else {
        const qtyIdx = descText.indexOf("Qté");
        if (qtyIdx > 0) {
          opPart = descText.slice(0, qtyIdx).trim();
        }
      }

      const { label, operation } = normalizeReleveOperation(opPart);

      // Parse quantity and price
      let quantity = "";
      let price = "";
      if (qtyMatch) {
        const qtyVal = qtyMatch[1].replace(/\s/g, "").replace(",", ".");
        if (qtyVal !== "0") quantity = qtyVal;
      }
      if (coursMatch) {
        const coursVal = coursMatch[1].replace(/\s/g, "").replace(",", ".");
        if (coursVal !== "0") price = coursVal;
      }

      let netAmount: number;
      if (!isNaN(debit) && debit > 0) {
        netAmount = -debit; // Debits are negative
      } else {
        netAmount = credit; // Credits are positive
      }

      transactions.push({
        date: dateText,
        label,
        operation,
        quantity,
        price,
        netAmount,
      });
    }

    return transactions;
  } catch {
    // Failed to parse this month — log and continue
    return [];
  } finally {
    await newPage.close();
  }
}

/**
 * Fetches and parses all available monthly statements (up to 13 months).
 *
 * Opens each month's releveCompte.php in a new tab, parses it,
 * and returns all transactions found.
 */
export async function scrapeReleves(
  page: Page,
  nc: string
): Promise<Transaction[]> {
  const spinner = createSpinner("Loading monthly statements (13 months)...");
  spinner.start();

  const context = page.context();
  const allTransactions: Transaction[] = [];
  const now = new Date();
  let monthsWithData = 0;

  for (let i = 1; i <= 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const dt = lastDayOfMonth(year, month);
    const monthLabel = d.toLocaleString("fr-FR", {
      month: "long",
      year: "numeric",
    });

    const transactions = await parseReleveCompte(context, nc, dt, year, month);

    if (transactions.length > 0) {
      monthsWithData++;
      allTransactions.push(...transactions);
    }
  }

  spinner.stop(
    `📜 Loaded ${allTransactions.length} transactions from ${monthsWithData} monthly statements`
  );
  return allTransactions;
}

// =============================================================================
// MERGE & EXPORT
// =============================================================================

/**
 * Merges transactions from both sources, deduplicates, and sorts.
 *
 * Deduplication uses (date + label + netAmount) as the key.
 * When duplicates exist, the historique version is preferred (cleaner data).
 */
function mergeTransactions(
  historique: Transaction[],
  releves: Transaction[]
): Transaction[] {
  const seen = new Map<string, Transaction>();

  // Add historique first (preferred source)
  for (const tx of historique) {
    seen.set(deduplicationKey(tx), tx);
  }

  // Add relevé transactions only if not already present
  for (const tx of releves) {
    const key = deduplicationKey(tx);
    if (!seen.has(key)) {
      seen.set(key, tx);
    }
  }

  // Sort by date descending (newest first)
  const sorted = Array.from(seen.values()).sort((a, b) => {
    const [da, ma, ya] = a.date.split("/").map(Number);
    const [db, mb, yb] = b.date.split("/").map(Number);
    const dateA = new Date(ya, ma - 1, da);
    const dateB = new Date(yb, mb - 1, db);
    return dateB.getTime() - dateA.getTime();
  });

  return sorted;
}

/**
 * Converts an array of transactions to CSV content.
 */
function transactionsToCsv(transactions: Transaction[]): string {
  const lines = [CSV_HEADER];
  for (const tx of transactions) {
    lines.push(transactionToCsvLine(tx));
  }
  return lines.join("\n");
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Extracts all transactions for all accounts.
 *
 * For each account:
 *   1. Scrapes the historique table (recent, clean data)
 *   2. Fetches all available monthly statements (13-month backfill)
 *   3. Merges, deduplicates, and returns as CSV content
 *
 * @returns Array of { accountName, csvContent, startDate } for saving
 */
export async function extractTransactions(
  page: Page
): Promise<Array<{ accountName: string; csvContent: string; startDate: string }>> {
  // Step 1: Scrape historique (also gives us the account list)
  const historiqueTransactions = await scrapeHistorique(page);

  // Get account info from the historique page's iframe
  const frame = await getLegacyFrame(page);
  const accounts = await getAccounts(frame);

  if (accounts.length === 0) {
    console.log("⚠️ No accounts found");
    return [];
  }

  const results: Array<{
    accountName: string;
    csvContent: string;
    startDate: string;
  }> = [];

  for (const account of accounts) {
    console.log(`\n📋 Processing account: ${account.name}`);

    // Step 2: Fetch monthly statements for this account
    const releveTransactions = await scrapeReleves(page, account.nc);

    // Step 3: Merge and deduplicate
    const merged = mergeTransactions(historiqueTransactions, releveTransactions);

    if (merged.length === 0) {
      console.log("  ⚠️ No transactions found");
      continue;
    }

    // Find the earliest date for the filename
    const startDate = merged[merged.length - 1].date
      .split("/")
      .reverse()
      .join("-"); // DD/MM/YYYY → YYYY-MM-DD

    const csvContent = transactionsToCsv(merged);

    console.log(
      `  ✓ ${merged.length} transactions (${merged[merged.length - 1].date} → ${merged[0].date})`
    );

    results.push({
      accountName: account.name,
      csvContent,
      startDate,
    });
  }

  return results;
}
