/**
 * Balance extraction for Caisse d'Épargne
 *
 * Extracts account balances from the API response captured during login.
 * No additional scraping is needed since all data is in the API response.
 */

import { AccountBalance } from "../../lib/types";

/**
 * Extracts account balances from the API response
 *
 * The API response (augmentedSynthesisViews) contains an array of items,
 * each representing an account with its identity (name, balance) and
 * identification (contract IDs).
 *
 * @param apiData The API response data from augmentedSynthesisViews
 * @returns Array of account balances
 */
export function extractBalances(apiData: any): AccountBalance[] {
  const items = apiData?.items || [];

  return items
    .filter((item: any) => item.identity?.balance !== null)
    .map((item: any) => ({
      account: item.identity.contractLabel,
      balance: item.identity.balance.value,
    }));
}

/**
 * Extracts account names from API data
 *
 * Used for guard checks to determine which accounts need transaction downloads.
 *
 * @param apiData The API response data from augmentedSynthesisViews
 * @returns Array of account names
 */
export function extractAccountNames(apiData: any): string[] {
  const items = apiData?.items || [];

  return items
    .filter((item: any) => item.identification?.contractPfmId)
    .map(
      (item: any) =>
        item.identity?.contractLabel ||
        `Account ${item.identification.contractPfmId}`
    );
}
