/**
 * Balance extraction for Bourse Direct
 *
 * Navigates to the inventory page (/fr/page/inventaire) and extracts
 * account balances from the legacy iframe (src="/priv/new/compte.php").
 *
 * The iframe contains:
 * - An account selector dropdown (<select id="nc">) with one option per account
 * - A table (table.table-bd) with rows: TOTAL, Solde espèces, Titres en
 *   portefeuille, +/- values SRD, Encours SRD, Disponible au comptant/SRD
 *
 * For each account, we extract the TOTAL row value as the balance.
 * The account name is extracted from the dropdown option text
 * (e.g., "508TI...EUR MR NAME (Compte Titre ordinaire)" → "Compte Titre ordinaire").
 */

import { Page, Frame } from "playwright";
import { AccountBalance } from "../../lib/types";
import { INVENTORY_URL, SELECTORS } from "./config";
import { createSpinner } from "../../lib/spinner";

/**
 * Extracts the account type from a dropdown option text.
 *
 * The dropdown text looks like:
 *   "508TI...EUR MR LASTNAME FIRSTNAME (Compte Titre ordinaire)"
 *
 * We extract the part in parentheses. If no parentheses are found,
 * fall back to the full text (trimmed).
 */
function extractAccountName(optionText: string): string {
  const match = optionText.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : optionText.trim();
}

/**
 * Parses a French-formatted number string.
 * e.g., "1 234,56 €" → 1234.56
 */
function parseFrenchNumber(text: string): number {
  return parseFloat(
    text
      .replace(/[€\s\u00a0]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

/**
 * Extracts the TOTAL balance from the inventory table inside the iframe.
 *
 * The table structure is:
 *   Row 0: Headers (Description | Valorisation au DD/MM | ...)
 *   Row 1: TOTAL | 10 000,00 € | ...
 *   Row 2+: Detail rows
 *
 * We find the row whose first cell contains "TOTAL" and read the
 * second cell (today's valorisation).
 */
async function extractTotalFromTable(frame: Frame): Promise<number | null> {
  const rows = await frame.$$(`${SELECTORS.inventoryTable} tr`);

  for (const row of rows) {
    // The description column uses <th>, the value columns use <td>
    const th = await row.$("th");
    if (!th) continue;

    const description = (await th.innerText()).trim();
    if (description === "TOTAL") {
      const tds = await row.$$("td");
      if (tds.length === 0) continue;
      // First <td> is today's valorisation
      const valueText = (await tds[0].innerText()).trim();
      const value = parseFrenchNumber(valueText);
      return isNaN(value) ? null : value;
    }
  }

  return null;
}

/**
 * Extracts account balances from the Bourse Direct inventory page.
 *
 * Navigates to the inventory page, accesses the legacy iframe,
 * iterates through all accounts in the dropdown, and extracts
 * the TOTAL balance for each.
 *
 * @param page Playwright page instance (must be logged in)
 * @returns Array of account balances
 */
export async function extractBalances(page: Page): Promise<AccountBalance[]> {
  const spinner = createSpinner("Loading inventory page...");
  spinner.start();

  // Navigate to inventory page (domcontentloaded — WebSocket streams block networkidle)
  await page.goto(INVENTORY_URL, { waitUntil: "domcontentloaded" });

  // Wait for the legacy iframe to appear
  await page.waitForSelector(SELECTORS.legacyIframe, { timeout: 15000 });

  // Access the iframe content
  const iframeElement = await page.$(SELECTORS.legacyIframe);
  if (!iframeElement) {
    spinner.stop();
    throw new Error("Could not find inventory iframe");
  }

  const frame = await iframeElement.contentFrame();
  if (!frame) {
    spinner.stop();
    throw new Error("Could not access inventory iframe content");
  }

  // Wait for the table to render inside the iframe
  await frame.waitForSelector(SELECTORS.inventoryTable, {
    state: "visible",
    timeout: 15000,
  });

  // Wait for the account dropdown to be available
  await frame.waitForSelector(SELECTORS.accountSelect, {
    timeout: 10000,
  });

  spinner.stop("📊 Inventory page loaded");

  // Get all account options from the dropdown
  const options = await frame.$$(`${SELECTORS.accountSelect} option`);

  if (options.length === 0) {
    console.log("⚠️ No accounts found in dropdown");
    return [];
  }

  console.log(`Found ${options.length} account(s)`);

  const balances: AccountBalance[] = [];

  for (let i = 0; i < options.length; i++) {
    const optionText = (await options[i].innerText()).trim();
    const optionValue = await options[i].getAttribute("value");
    const accountName = extractAccountName(optionText);

    // Select this account (if not already selected)
    if (i > 0) {
      await frame.selectOption(SELECTORS.accountSelect, { index: i });
      // Wait for the table to update after account switch
      await page.waitForTimeout(2000);
    }

    // Extract the TOTAL from the table
    const total = await extractTotalFromTable(frame);

    if (total !== null) {
      balances.push({ account: accountName, balance: total });
      console.log(
        `  ✓ ${accountName}: ${total.toLocaleString("fr-FR")} €`
      );
    } else {
      console.log(
        `  ⚠️ ${accountName}: could not extract TOTAL (value=${optionValue})`
      );
    }
  }

  return balances;
}
