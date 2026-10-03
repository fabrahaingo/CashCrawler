/**
 * Transaction extraction for Bourse Direct
 *
 * Two data sources, merged and deduplicated:
 *
 * 1. **Historique de compte** (`historique-de-compte.php`)
 *    Clean HTML table with recent transactions (~3 months, no pagination).
 *    Fetched via direct HTTP request (no iframe navigation needed).
 *
 * 2. **Relevés mensuels** (`releveCompte.php`)
 *    Monthly account statements going back 13 months. Messy legacy HTML
 *    with parallel nested tables. Fetched in parallel via page tabs.
 *    Note: not all months have statements — months that fail are skipped.
 *
 * Both sources are normalized into a common Transaction format, merged,
 * deduplicated, and saved as semicolon-separated CSV.
 */

import { Page, BrowserContext } from "playwright";
import { getReleveCompteUrl } from "./config";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

export interface Transaction {
  /** Operation date in DD/MM/YYYY format */
  date: string;
  /** Security name or description */
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

/** Account info extracted from the HTML */
export interface AccountInfo {
  /** The dropdown option value (e.g., "1") */
  nc: string;
  /** The account display name (e.g., "Compte Titre ordinaire") */
  name: string;
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function parseFrenchNumber(text: string): number {
  const cleaned = text
    .replace(/[€\s\u00a0]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return parseFloat(cleaned);
}

function extractAccountName(optionText: string): string {
  const match = optionText.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : optionText.trim();
}

/** Strips HTML tags from a string. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

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

function deduplicationKey(tx: Transaction): string {
  const shortLabel = tx.label.slice(0, 15).trim();
  return `${tx.date}|${shortLabel}|${tx.netAmount.toFixed(2)}`;
}

const CSV_HEADER = "date;label;operation;quantity;price;net_amount";

// =============================================================================
// SOURCE 1: HISTORIQUE DE COMPTE (direct HTTP fetch + HTML parsing)
// =============================================================================

/**
 * Fetches and parses transactions from historique-de-compte.php via HTTP.
 * Also extracts the account list from the <select> dropdown.
 *
 * This is ~7x faster than navigating to the page and accessing the iframe.
 */
async function fetchHistoriqueHttp(
  context: BrowserContext
): Promise<{ transactions: Transaction[]; accounts: AccountInfo[] }> {
  const res = await context.request.get(
    "https://www.boursedirect.fr/priv/new/historique-de-compte.php"
  );
  const html = await res.text();

  // ── Extract accounts from <select id="nc"> ──────────────────────
  const accounts: AccountInfo[] = [];
  const optionRegex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let optMatch;
  while ((optMatch = optionRegex.exec(html)) !== null) {
    accounts.push({
      nc: optMatch[1],
      name: extractAccountName(optMatch[2].trim()),
    });
  }

  // ── Extract transactions from table.datas.retour ────────────────
  // The table class is "datas retour table-color-row"
  const tableMatch = html.match(
    /<table[^>]*class="datas retour[^"]*"[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch) {
    return { transactions: [], accounts };
  }

  const transactions: Transaction[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }

    if (cells.length < 7) continue;

    const dateOp = cells[0].trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateOp)) continue;

    const label = cells[2].trim();
    let operation = cells[3].trim();
    const qtyText = cells[4].trim();
    const priceText = cells[5].trim();
    const amountText = cells[6].trim();

    const netAmount = parseFrenchNumber(amountText);
    if (isNaN(netAmount)) continue;

    if (!operation) {
      operation = label.includes("TTF") ? "TAXE" : "FRAIS";
    }

    const quantity = qtyText === "--" ? "" : qtyText.replace(/\s/g, "");
    const price =
      priceText === "--" ? "" : parseFrenchNumber(priceText).toString();

    transactions.push({
      date: dateOp,
      label,
      operation: operation.trim(),
      quantity,
      price,
      netAmount,
    });
  }

  return { transactions, accounts };
}

// =============================================================================
// SOURCE 2: RELEVES MENSUELS (monthly statements, parallel page tabs)
// =============================================================================

function lastDayOfMonth(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return (
    String(year) +
    String(month).padStart(2, "0") +
    String(lastDay).padStart(2, "0")
  );
}

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

  return { label: "", operation: desc };
}

/**
 * Parses a single monthly statement page for transactions.
 * Opens the page in a new tab, extracts transaction rows from the
 * parallel nested table structure, then closes the tab.
 */
async function parseReleveCompte(
  context: BrowserContext,
  nc: string,
  dt: string
): Promise<Transaction[]> {
  const url = getReleveCompteUrl(nc, dt);
  const newPage = await context.newPage();

  try {
    await newPage.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await newPage.waitForTimeout(1000);

    const bodyText = await newPage.$eval(
      "body",
      (el) => (el as HTMLElement).innerText
    );
    if (!bodyText.includes("RELEVE DE COMPTE")) {
      return [];
    }

    const tableauCells = await newPage.$$("td.tableau");
    if (tableauCells.length < 8) {
      return [];
    }

    const extractColumnRows = async (cell: any): Promise<string[]> => {
      const rows = await cell.$$("table tr");
      const texts: string[] = [];
      for (const row of rows) {
        texts.push((await row.innerText()).trim());
      }
      return texts;
    };

    const dateRows = await extractColumnRows(tableauCells[4]);
    const descRows = await extractColumnRows(tableauCells[5]);
    const debitRows = await extractColumnRows(tableauCells[6]);
    const creditRows = await extractColumnRows(tableauCells[7]);

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

      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) continue;
      if (descText.includes("Solde au")) continue;
      if (descText.includes("Cumul mouvements")) continue;
      if (!descText || descText === "\u00a0") continue;

      const debit = debitText ? parseFrenchNumber(debitText) : NaN;
      const credit = creditText ? parseFrenchNumber(creditText) : NaN;
      if ((isNaN(debit) || debit === 0) && (isNaN(credit) || credit === 0)) {
        continue;
      }

      const qtyMatch = descText.match(/Qté\s*:\s*([-\d\s,]+)/);
      const coursMatch = descText.match(/Cours\s*:\s*([\d\s,]+)/);

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
        netAmount = -debit;
      } else {
        netAmount = credit;
      }

      transactions.push({ date: dateText, label, operation, quantity, price, netAmount });
    }

    return transactions;
  } catch {
    return [];
  } finally {
    await newPage.close();
  }
}

/**
 * Fetches monthly statements in parallel batches.
 * Opens up to 4 tabs at a time to avoid overloading the browser.
 */
async function scrapeReleves(
  context: BrowserContext,
  nc: string
): Promise<Transaction[]> {
  const spinner = createSpinner("Loading monthly statements (13 months)...");
  spinner.start();

  const now = new Date();
  const monthParams: { dt: string; label: string }[] = [];

  for (let i = 1; i <= 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    monthParams.push({
      dt: lastDayOfMonth(year, month),
      label: d.toLocaleString("fr-FR", { month: "long", year: "numeric" }),
    });
  }

  const allTransactions: Transaction[] = [];
  let monthsWithData = 0;

  // Process in parallel batches of 4
  const BATCH_SIZE = 4;
  for (let i = 0; i < monthParams.length; i += BATCH_SIZE) {
    const batch = monthParams.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((m) => parseReleveCompte(context, nc, m.dt))
    );
    for (const txs of results) {
      if (txs.length > 0) {
        monthsWithData++;
        allTransactions.push(...txs);
      }
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

function mergeTransactions(
  historique: Transaction[],
  releves: Transaction[]
): Transaction[] {
  const seen = new Map<string, Transaction>();

  for (const tx of historique) {
    seen.set(deduplicationKey(tx), tx);
  }

  for (const tx of releves) {
    const key = deduplicationKey(tx);
    if (!seen.has(key)) {
      seen.set(key, tx);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const [da, ma, ya] = a.date.split("/").map(Number);
    const [db, mb, yb] = b.date.split("/").map(Number);
    return new Date(yb, mb - 1, db).getTime() - new Date(ya, ma - 1, da).getTime();
  });
}

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
 * 1. Fetches historique via direct HTTP (fast, ~150ms)
 * 2. Extracts account list from the same response
 * 3. Fetches monthly statements in parallel batches
 * 4. Merges, deduplicates, and returns as CSV
 */
export async function extractTransactions(
  page: Page
): Promise<Array<{ accountName: string; csvContent: string; startDate: string }>> {
  const context = page.context();

  // Step 1: Fetch historique via HTTP (also gives us the account list)
  const spinner = createSpinner("Fetching account history...");
  spinner.start();

  const { transactions: historiqueTransactions, accounts } =
    await fetchHistoriqueHttp(context);

  spinner.stop(
    `📊 ${historiqueTransactions.length} transactions from historique`
  );

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

    // Step 2: Fetch monthly statements in parallel
    const releveTransactions = await scrapeReleves(context, account.nc);

    // Step 3: Merge and deduplicate
    const merged = mergeTransactions(historiqueTransactions, releveTransactions);

    if (merged.length === 0) {
      console.log("  ⚠️ No transactions found");
      continue;
    }

    const startDate = merged[merged.length - 1].date
      .split("/")
      .reverse()
      .join("-");

    const csvContent = transactionsToCsv(merged);

    console.log(
      `  ✓ ${merged.length} transactions (${merged[merged.length - 1].date} → ${merged[0].date})`
    );

    results.push({ accountName: account.name, csvContent, startDate });
  }

  return results;
}
