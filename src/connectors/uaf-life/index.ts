/**
 * UAF Life Patrimoine Connector
 *
 * Environment variables required:
 * - UAF_USERNAME: Your user identifier
 * - UAF_PASSWORD: Your password
 *
 * Usage:
 *   npm run uaf:balances       # Get account balances
 *   npm run uaf:transactions   # Get transaction history
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
 * Retrieves account balances for UAF Life
 */
export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.UAF_LIFE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  await withBrowser(
    async (page) => {
      await login(
        page,
        process.env.UAF_USERNAME ?? "",
        process.env.UAF_PASSWORD ?? ""
      );

      console.log("💰 Retrieving account balances...");
      const balances = await extractBalances(page);

      if (balances.length === 0) {
        console.log(
          "⚠️ No balances found. Run with DEBUG_BROWSER=1 to investigate."
        );
        return;
      }

      const savedPath = saveBalances(
        BANK_IDS.UAF_LIFE,
        balances as StoredBalance[]
      );
      console.log(`💾 Balances saved to: ${savedPath}`);

      console.log("💰 Retrieved balances:");
      for (const { account, balance } of balances) {
        console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
      }
    },
    { persistContext: BANK_IDS.UAF_LIFE }
  );
}

/**
 * Retrieves transaction history for UAF Life contracts
 */
export async function getTransactions(): Promise<void> {
  await withBrowser(
    async (page) => {
      await login(
        page,
        process.env.UAF_USERNAME ?? "",
        process.env.UAF_PASSWORD ?? ""
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
          BANK_IDS.UAF_LIFE,
          accountName,
          startDate,
          csvContent
        );
        console.log(`💾 Transactions saved to: ${savedPath}`);
      }
    },
    { persistContext: BANK_IDS.UAF_LIFE }
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
        process.env.UAF_USERNAME ?? "",
        process.env.UAF_PASSWORD ?? ""
      );

      console.log("💰 Retrieving account balances...");
      const balances = await extractBalances(page);

      if (balances.length === 0) {
        console.log(
          "⚠️ No balances found. Run with DEBUG_BROWSER=1 to investigate."
        );
      } else {
        const savedPath = saveBalances(
          BANK_IDS.UAF_LIFE,
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
            BANK_IDS.UAF_LIFE,
            accountName,
            startDate,
            csvContent
          );
          console.log(`💾 Transactions saved to: ${savedPath}`);
        }
      }
    },
    { persistContext: BANK_IDS.UAF_LIFE }
  );
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case "balances":
      getBalances().catch((err) => {
        console.error("❌ Failed to get balances:", err);
        process.exit(1);
      });
      break;

    case "transactions":
      getTransactions().catch((err) => {
        console.error("❌ Failed to get transactions:", err);
        process.exit(1);
      });
      break;

    default:
      getAll().catch((err) => {
        console.error("❌ Failed:", err);
        process.exit(1);
      });
  }
}
