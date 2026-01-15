/**
 * Balance extraction for UAF Life Patrimoine
 *
 * Scrapes account balances from the dashboard. The data is displayed
 * in an iframe containing a table with account information.
 */

import { Page, Frame } from "playwright";
import { AccountBalance } from "../../lib/types";
import { SELECTORS } from "./config";
import { createSpinner } from "../../lib/spinner";

/**
 * Extracts account balances from the UAF Life dashboard
 *
 * The dashboard contains an iframe with a table. Each row has:
 * - A cell with data-title="Produit" containing the account name
 * - A cell with data-title="Encours" containing the balance
 *
 * @param page Playwright page instance (must be on the dashboard)
 * @returns Array of account balances
 */
export async function extractBalances(page: Page): Promise<AccountBalance[]> {
  const accountBalances: AccountBalance[] = [];

  // Wait for the iframe to load
  const spinner = createSpinner("Loading account data...");
  spinner.start();

  let frame: Frame;
  try {
    await page.waitForSelector(SELECTORS.accountIframe, { timeout: 20000 });

    // Get the iframe
    const iframeElement = await page.$(SELECTORS.accountIframe);
    if (!iframeElement) {
      throw new Error("Could not find account iframe");
    }

    const contentFrame = await iframeElement.contentFrame();
    if (!contentFrame) {
      throw new Error("Could not access iframe content");
    }
    frame = contentFrame;

    // Wait for balance cells to load
    await frame.waitForSelector(SELECTORS.balanceCell, {
      state: "visible",
      timeout: 10000,
    });

    spinner.stop("⏳ Account data loaded");
  } catch (error) {
    spinner.stop();
    throw error;
  }

  // Get all table rows
  const rows = await frame.$$(`${SELECTORS.accountTable} tr`);

  // Skip template rows (first 3 rows are typically headers/templates)
  const templateRowsCount = 3;
  console.log(`Found ${rows.length - templateRowsCount} accounts`);

  for (const row of rows) {
    try {
      const nameCell = await row.$(SELECTORS.accountNameCell);
      const balanceCell = await row.$(SELECTORS.balanceCell);

      if (nameCell && balanceCell) {
        const name = (await nameCell.innerText()).trim();
        const balanceText = (await balanceCell.innerText()).trim();

        // Parse balance: remove spaces, € symbol, convert comma to dot
        const balance = parseFloat(
          balanceText
            .replace(/\s/g, "")
            .replace(/€/g, "")
            .replace(",", ".")
        );

        if (!isNaN(balance) && name) {
          accountBalances.push({ account: name, balance });
          console.log(`✓ Found account: ${name}`);
        }
      }
    } catch (error) {
      // Skip rows that can't be parsed
      continue;
    }
  }

  return accountBalances;
}
