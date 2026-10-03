/**
 * Swile Connector (meal vouchers)
 *
 * Environment variables required:
 * - SWILE_USERNAME: Swile account email
 * - SWILE_PASSWORD: Swile account password
 * - SWILE_OTP (optional): email verification code, for non-interactive runs
 *
 * First login on a machine triggers an email verification code; the
 * resulting device trust + refresh token are persisted so later runs
 * are fully non-interactive (and usually make zero login requests).
 *
 * Pure API connector — no browser involved.
 *
 * Usage:
 *   npm run swile:balances       # Get wallet balance
 *   npm run swile:transactions   # Get full payments history
 *   npm run swile:all            # Both
 */

import "dotenv/config";
import { login } from "./auth";
import { extractBalances } from "./balances";
import { extractTransactions } from "./transactions";
import { BANK_IDS } from "../../lib/types";
import {
  saveBalances,
  hasBalancesForToday,
  saveTransactionsCSV,
  StoredBalance,
} from "../../lib/storage";

async function getToken(): Promise<string> {
  return login(
    process.env.SWILE_USERNAME ?? "",
    process.env.SWILE_PASSWORD ?? ""
  );
}

async function runBalances(token: string): Promise<void> {
  console.log("💰 Retrieving wallet balance...");
  const balances = await extractBalances(token);

  if (balances.length === 0) {
    console.log("⚠️ No balances found.");
    return;
  }

  const savedPath = saveBalances(BANK_IDS.SWILE, balances as StoredBalance[]);
  console.log(`💾 Balances saved to: ${savedPath}`);
  for (const { account, balance } of balances) {
    console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
  }
}

async function runTransactions(token: string): Promise<void> {
  console.log("📋 Retrieving payments history...");
  const results = await extractTransactions(token);

  if (results.length === 0) {
    console.log("⚠️ No transactions found.");
    return;
  }

  for (const { accountName, csvContent, startDate } of results) {
    const savedPath = saveTransactionsCSV(
      BANK_IDS.SWILE,
      accountName,
      startDate,
      csvContent
    );
    console.log(`💾 Transactions saved to: ${savedPath}`);
  }
}

export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.SWILE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }
  await runBalances(await getToken());
}

export async function getTransactions(): Promise<void> {
  await runTransactions(await getToken());
}

export async function getAll(): Promise<void> {
  const token = await getToken();
  await runBalances(token);
  await runTransactions(token);
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const command = process.argv[2];

  // Explicit exit: the readline OTP prompt keeps stdin open otherwise
  const run =
    command === "balances"
      ? getBalances
      : command === "transactions"
        ? getTransactions
        : getAll;

  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Failed:", err);
      process.exit(1);
    });
}
