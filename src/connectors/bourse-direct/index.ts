/**
 * Bourse Direct Connector
 *
 * Environment variables required:
 * - BOURSE_DIRECT_USERNAME: Your user identifier
 * - BOURSE_DIRECT_PASSWORD: Your password
 *
 * Usage:
 *   npm run bourse-direct:balances       # Get portfolio balances
 *   npm run bourse-direct:transactions   # Get transaction history
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
 * Retrieves portfolio balances for Bourse Direct
 */
export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.BOURSE_DIRECT)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  await withBrowser(
    async (page) => {
      await login(
        page,
        process.env.BOURSE_DIRECT_USERNAME ?? "",
        process.env.BOURSE_DIRECT_PASSWORD ?? ""
      );

      console.log("💰 Retrieving portfolio balances...");
      const balances = await extractBalances(page);

      if (balances.length === 0) {
        console.log(
          "⚠️ No balances found. Run with DEBUG_BROWSER=1 to investigate."
        );
        return;
      }

      const savedPath = saveBalances(
        BANK_IDS.BOURSE_DIRECT,
        balances as StoredBalance[]
      );
      console.log(`💾 Balances saved to: ${savedPath}`);

      console.log("💰 Retrieved balances:");
      for (const { account, balance } of balances) {
        console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
      }
    },
    { persistContext: BANK_IDS.BOURSE_DIRECT }
  );
}

/**
 * Retrieves transaction history for Bourse Direct
 *
 * First run: fetches ~13 months of history (historique + monthly statements).
 * Subsequent runs: fetches recent transactions and merges with existing data.
 */
export async function getTransactions(): Promise<void> {
  await withBrowser(
    async (page) => {
      await login(
        page,
        process.env.BOURSE_DIRECT_USERNAME ?? "",
        process.env.BOURSE_DIRECT_PASSWORD ?? ""
      );

      console.log("📋 Retrieving transaction history...");
      const results = await extractTransactions(page);

      if (results.length === 0) {
        console.log(
          "⚠️ No transactions found. Run with DEBUG_BROWSER=1 to investigate."
        );
        return;
      }

      for (const { accountName, csvContent, startDate } of results) {
        const savedPath = saveTransactionsCSV(
          BANK_IDS.BOURSE_DIRECT,
          accountName,
          startDate,
          csvContent
        );
        console.log(`💾 Transactions saved to: ${savedPath}`);
      }
    },
    { persistContext: BANK_IDS.BOURSE_DIRECT }
  );
}

/**
 * Retrieves both balances and transactions in a single browser session
 */
export async function getAll(): Promise<void> {
  await withBrowser(
    async (page) => {
      await login(
        page,
        process.env.BOURSE_DIRECT_USERNAME ?? "",
        process.env.BOURSE_DIRECT_PASSWORD ?? ""
      );

      console.log("💰 Retrieving portfolio balances...");
      const balances = await extractBalances(page);

      if (balances.length === 0) {
        console.log(
          "⚠️ No balances found. Run with DEBUG_BROWSER=1 to investigate."
        );
      } else {
        const savedPath = saveBalances(
          BANK_IDS.BOURSE_DIRECT,
          balances as StoredBalance[]
        );
        console.log(`💾 Balances saved to: ${savedPath}`);

        console.log("💰 Retrieved balances:");
        for (const { account, balance } of balances) {
          console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
        }
      }

      console.log("📋 Retrieving transaction history...");
      const results = await extractTransactions(page);

      if (results.length === 0) {
        console.log(
          "⚠️ No transactions found. Run with DEBUG_BROWSER=1 to investigate."
        );
      } else {
        for (const { accountName, csvContent, startDate } of results) {
          const savedPath = saveTransactionsCSV(
            BANK_IDS.BOURSE_DIRECT,
            accountName,
            startDate,
            csvContent
          );
          console.log(`💾 Transactions saved to: ${savedPath}`);
        }
      }
    },
    { persistContext: BANK_IDS.BOURSE_DIRECT }
  );
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const command = process.argv[2];

  // Explicit exit needed: readline OTP prompt keeps stdin open
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
