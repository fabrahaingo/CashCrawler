/**
 * Transaction extraction for Sumeria
 *
 * Uses POST /history/_search to fetch all transactions for each account.
 * The API uses Elasticsearch-like queries with pagination (from/size).
 *
 * Transactions are fetched per-account using the emitter_id as the filter.
 * All pages are fetched until total is reached, then converted to CSV.
 */

import {
  fetchAccounts,
  fetchAllTransactions,
  historyItemToCsvLine,
  CSV_HEADER,
} from "./api";

export interface TransactionResult {
  accountName: string;
  csvContent: string;
  startDate: string;
}

/**
 * Extracts all transactions for all accounts.
 *
 * For each account:
 *   1. Fetches all transactions via paginated history/_search
 *   2. Converts to semicolon-separated CSV
 *   3. Returns CSV content with earliest date for filename
 *
 * @param token JWT access token
 * @returns Array of { accountName, csvContent, startDate } for saving
 */
export async function extractTransactions(
  token: string
): Promise<TransactionResult[]> {
  const accounts = await fetchAccounts(token);

  if (accounts.length === 0) {
    console.log("⚠️ No accounts found");
    return [];
  }

  console.log(`Found ${accounts.length} account(s)`);

  const results: TransactionResult[] = [];

  for (const account of accounts) {
    try {
      const items = await fetchAllTransactions(token, account);

      if (items.length === 0) {
        continue;
      }

      // Convert to CSV
      const csvLines = [CSV_HEADER];
      for (const item of items) {
        csvLines.push(historyItemToCsvLine(item));
      }
      const csvContent = csvLines.join("\n");

      // Find the earliest date for the filename
      const oldest = items[items.length - 1];
      const oldestDate = new Date(oldest.created_at);
      const startDate = oldestDate.toISOString().split("T")[0];

      results.push({
        accountName: account.name,
        csvContent,
        startDate,
      });
    } catch (error) {
      console.error(`⚠️ Failed to fetch transactions for ${account.name}: ${(error as Error).message}`);
    }
  }

  return results;
}
