/**
 * Sumeria Connector
 *
 * Environment variables required:
 * - SUMERIA_PHONE: Phone number in international format (e.g., "+33600000000")
 *
 * Login requires the Sumeria mobile app for OTP code verification.
 *
 * Usage:
 *   npm run sumeria:balances       # Get account balances
 *   npm run sumeria:transactions   # Get transaction history
 */

import "dotenv/config";
import { login } from "./login";
import { extractBalances } from "./balances";
import { extractTransactions } from "./transactions";
import { BANK_IDS } from "../../lib/types";
import { withBrowser } from "../../lib/browser";
import {
  saveBalances,
  hasBalancesForToday,
  saveTransactionsCSV,
  StoredBalance,
} from "../../lib/storage";

/**
 * Retrieves account balances for Sumeria
 */
export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.SUMERIA)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  await withBrowser(async (page) => {
    const token = await login(
      page,
      process.env.SUMERIA_PHONE ?? ""
    );

    console.log("💰 Retrieving account balances...");
    const balances = await extractBalances(token);

    if (balances.length === 0) {
      console.log("⚠️ No balances found.");
      return;
    }

    const savedPath = saveBalances(
      BANK_IDS.SUMERIA,
      balances as StoredBalance[]
    );
    console.log(`💾 Balances saved to: ${savedPath}`);

    console.log("💰 Retrieved balances:");
    for (const { account, balance } of balances) {
      console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
    }
  });
}

/**
 * Retrieves transaction history for Sumeria
 *
 * Fetches ALL transactions for ALL accounts via the history/_search API.
 * On subsequent runs, new transactions are merged with existing data.
 */
export async function getTransactions(): Promise<void> {
  await withBrowser(async (page) => {
    const token = await login(
      page,
      process.env.SUMERIA_PHONE ?? ""
    );

    console.log("📋 Retrieving transaction history...");
    const results = await extractTransactions(token);

    if (results.length === 0) {
      console.log("⚠️ No transactions found.");
      return;
    }

    for (const { accountName, csvContent, startDate } of results) {
      const savedPath = saveTransactionsCSV(
        BANK_IDS.SUMERIA,
        accountName,
        startDate,
        csvContent
      );
      console.log(`💾 Transactions saved to: ${savedPath}`);
    }
  });
}

/**
 * Retrieves both balances and transactions in a single browser session
 */
export async function getAll(): Promise<void> {
  await withBrowser(async (page) => {
    const token = await login(
      page,
      process.env.SUMERIA_PHONE ?? ""
    );

    console.log("💰 Retrieving account balances...");
    const balances = await extractBalances(token);

    if (balances.length === 0) {
      console.log("⚠️ No balances found.");
    } else {
      const savedPath = saveBalances(
        BANK_IDS.SUMERIA,
        balances as StoredBalance[]
      );
      console.log(`💾 Balances saved to: ${savedPath}`);

      console.log("💰 Retrieved balances:");
      for (const { account, balance } of balances) {
        console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
      }
    }

    console.log("📋 Retrieving transaction history...");
    const results = await extractTransactions(token);

    if (results.length === 0) {
      console.log("⚠️ No transactions found.");
    } else {
      for (const { accountName, csvContent, startDate } of results) {
        const savedPath = saveTransactionsCSV(
          BANK_IDS.SUMERIA,
          accountName,
          startDate,
          csvContent
        );
        console.log(`💾 Transactions saved to: ${savedPath}`);
      }
    }
  });
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const command = process.argv[2];

  // All commands must explicitly exit on success because the readline
  // OTP prompt keeps stdin open, preventing the event loop from draining.
  switch (command) {
    case "balances":
      getBalances()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error("❌ Failed to get balances:", err);
          process.exit(1);
        });
      break;

    case "transactions":
      getTransactions()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error("❌ Failed to get transactions:", err);
          process.exit(1);
        });
      break;

    default:
      getAll()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error("❌ Failed:", err);
          process.exit(1);
        });
  }
}
