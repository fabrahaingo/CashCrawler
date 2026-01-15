/**
 * Caisse d'Épargne Connector
 *
 * Main entry point for the Caisse d'Épargne bank connector.
 * Provides functions to retrieve balances and download transactions.
 *
 * Environment variables required:
 * - CE_USERNAME: Your user identifier (account number)
 * - CE_PASSWORD: Your password (digits only)
 *
 * Usage:
 *   npm run ce:balances     # Get account balances
 *   npm run ce:transactions # Download transaction history
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { login } from "./login";
import { extractBalances, extractAccountNames } from "./balances";
import { downloadTransactions } from "./transactions";
import { BANK_IDS } from "../../lib/types";
import {
  saveBalances,
  hasBalancesForToday,
  hasTransactionsForToday,
  StoredBalance,
} from "../../lib/storage";

/**
 * Retrieves account balances for Caisse d'Épargne
 *
 * Logs into the bank, captures the API response, and saves
 * balances to a JSON file. Skips if already retrieved today.
 */
export async function getBalances(): Promise<void> {
  // Guard: Check if balances have already been retrieved today
  if (hasBalancesForToday(BANK_IDS.CAISSE_EPARGNE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  const browser = await chromium
    .use(StealthPlugin())
    .launch({ headless: true });
  const page = await browser.newPage({ hasTouch: true });

  try {
    // Perform login and capture API response
    const apiData = await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );

    // Extract and save balances
    console.log("💰 Retrieving account balances...");
    const balances = extractBalances(apiData);

    const savedPath = saveBalances(
      BANK_IDS.CAISSE_EPARGNE,
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

/**
 * Downloads transactions for all accounts in Caisse d'Épargne
 *
 * Logs into the bank and downloads transaction history as CSV files.
 * Skips if already downloaded today.
 */
export async function getTransactions(): Promise<void> {
  const browser = await chromium
    .use(StealthPlugin())
    .launch({ headless: true });
  const page = await browser.newPage({ hasTouch: true });

  try {
    // Perform login and capture API response
    const apiData = await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );

    // Download transactions (includes guard check)
    console.log("💳 Starting transaction download...");
    await downloadTransactions(page, apiData);
  } finally {
    await browser.close();
  }
}

// =============================================================================
// CLI ENTRY POINTS
// =============================================================================

// Determine which function to run based on command line argument
const command = process.argv[2];

if (command === "balances") {
  getBalances().catch((err) => {
    console.error("❌ Failed to get balances:", err);
    process.exit(1);
  });
} else if (command === "transactions") {
  getTransactions().catch((err) => {
    console.error("❌ Failed to get transactions:", err);
    process.exit(1);
  });
} else if (require.main === module) {
  // Default to balances if run directly without argument
  getBalances().catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
  });
}
