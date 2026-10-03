/**
 * Balance extraction for Sumeria
 *
 * Uses the REST API directly (no browser scraping needed).
 * GET /accounts returns all accounts with their current balances.
 */

import { AccountBalance } from "../../lib/types";
import { fetchAccounts } from "./api";

/**
 * Extracts account balances from the Sumeria API.
 *
 * @param token JWT access token
 * @returns Array of account balances
 */
export async function extractBalances(
  token: string
): Promise<AccountBalance[]> {
  const accounts = await fetchAccounts(token);

  return accounts.map((account) => ({
    account: account.name,
    balance: parseFloat(account.balance),
  }));
}
