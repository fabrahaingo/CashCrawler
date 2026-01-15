/**
 * UAF Life Patrimoine Connector
 *
 * Main entry point for the UAF Life bank connector.
 * Currently only supports balance retrieval (no transaction download).
 *
 * Environment variables required:
 * - UAF_USERNAME: Your user identifier
 * - UAF_PASSWORD: Your password
 *
 * Usage:
 *   npm run uaf:balances  # Get account balances
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { login } from "./login";
import { extractBalances } from "./balances";
import { BANK_IDS } from "../../lib/types";
import {
  saveBalances,
  hasBalancesForToday,
  StoredBalance,
} from "../../lib/storage";

/**
 * Retrieves account balances for UAF Life
 *
 * Logs into the platform, scrapes the dashboard, and saves
 * balances to a JSON file. Skips if already retrieved today.
 */
export async function getBalances(): Promise<void> {
  // Guard: Check if balances have already been retrieved today
  if (hasBalancesForToday(BANK_IDS.UAF_LIFE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  const browser = await chromium
    .use(StealthPlugin())
    .launch({ headless: true });
  const page = await browser.newPage({ hasTouch: true });

  try {
    // Perform login
    await login(
      page,
      process.env.UAF_USERNAME ?? "",
      process.env.UAF_PASSWORD ?? ""
    );

    // Extract and save balances
    console.log("💰 Retrieving account balances...");
    const balances = await extractBalances(page);

    const savedPath = saveBalances(
      BANK_IDS.UAF_LIFE,
      balances as StoredBalance[]
    );
    console.log(`💾 Balances saved to: ${savedPath}`);

    console.log("💰 Retrieved balances:");
    for (const { account, balance } of balances) {
      console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
    }
  } finally {
    await browser.close();
  }
}

// CLI entry point
if (require.main === module) {
  getBalances().catch((err) => {
    console.error("❌ Failed to get balances:", err);
    process.exit(1);
  });
}
