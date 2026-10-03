/**
 * Caisse d'Épargne Connector
 *
 * Environment variables required:
 * - CE_USERNAME: Your user identifier (account number)
 * - CE_PASSWORD: Your password (digits only)
 *
 * Usage:
 *   npm run ce:balances     # Get account balances
 *   npm run ce:transactions # Download transaction history (PFM API)
 *   npm run ce:discover     # Record API calls while navigating by hand
 */

import "dotenv/config";
import { login } from "./login";
import { extractBalances } from "./balances";
import { downloadTransactions } from "./transactions";
import { discoverApiCalls } from "./discover";
import { BANK_IDS } from "../../lib/types";
import { withBrowser } from "../../lib/browser";
import { saveBalances, hasBalancesForToday, StoredBalance } from "../../lib/storage";

/**
 * Retrieves account balances for Caisse d'Épargne
 */
export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.CAISSE_EPARGNE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  await withBrowser(async (page) => {
    const { apiData } = await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );

    console.log("💰 Retrieving account balances...");
    const balances = extractBalances(apiData);

    const savedPath = saveBalances(BANK_IDS.CAISSE_EPARGNE, balances as StoredBalance[]);
    console.log(`💾 Balances saved to: ${savedPath}`);

    console.log("💰 Retrieved balances:");
    for (const { account, balance } of balances) {
      console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
    }
  });
}

/**
 * Downloads transactions for all accounts in Caisse d'Épargne
 *
 * Uses the PFM API which returns all transactions (~2 years) in a single
 * call per account, with rich metadata including counterparty details,
 * auto-categorization, and parsed transaction labels.
 */
export async function getTransactions(): Promise<void> {
  await withBrowser(async (page) => {
    const { apiData, authToken } = await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );

    if (!authToken) {
      throw new Error("No auth token captured — cannot call PFM API");
    }

    console.log("💳 Starting transaction download (PFM API)...");
    await downloadTransactions(page, apiData, authToken);
  });
}

/**
 * Retrieves both balances and transactions in a single browser session
 */
export async function getAll(): Promise<void> {
  await withBrowser(async (page) => {
    const { apiData, authToken } = await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );

    console.log("💰 Retrieving account balances...");
    const balances = extractBalances(apiData);

    const savedPath = saveBalances(BANK_IDS.CAISSE_EPARGNE, balances as StoredBalance[]);
    console.log(`💾 Balances saved to: ${savedPath}`);

    console.log("💰 Retrieved balances:");
    for (const { account, balance } of balances) {
      console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
    }

    if (authToken) {
      console.log("💳 Starting transaction download (PFM API)...");
      await downloadTransactions(page, apiData, authToken);
    }
  });
}

/**
 * Logs in with a visible browser and records the CE API calls made while
 * the user navigates (see discover.ts). Run with DEBUG_BROWSER=1.
 */
export async function discover(): Promise<void> {
  await withBrowser(async (page) => {
    await login(
      page,
      process.env.CE_USERNAME ?? "",
      process.env.CE_PASSWORD ?? ""
    );
    await discoverApiCalls(page);
  });
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const command = process.argv[2];

  if (command === "balances") {
    getBalances().catch((err) => {
      console.error("❌ Failed to get balances:", err);
      process.exit(1);
    });
  } else if (command === "discover") {
    discover().catch((err) => {
      console.error("❌ Discovery failed:", err);
      process.exit(1);
    });
  } else if (command === "transactions") {
    getTransactions().catch((err) => {
      console.error("❌ Failed to get transactions:", err);
      process.exit(1);
    });
  } else {
    getAll().catch((err) => {
      console.error("❌ Failed:", err);
      process.exit(1);
    });
  }
}
