/**
 * UAF Life Patrimoine Connector
 *
 * Environment variables required:
 * - UAF_USERNAME: Your user identifier
 * - UAF_PASSWORD: Your password
 *
 * Usage:
 *   npm run uaf:balances  # Get account balances
 */

import "dotenv/config";
import { login } from "./login";
import { extractBalances } from "./balances";
import { BANK_IDS } from "../../lib/types";
import { withBrowser } from "../../lib/browser";
import { saveBalances, hasBalancesForToday, StoredBalance } from "../../lib/storage";

/**
 * Retrieves account balances for UAF Life
 */
export async function getBalances(): Promise<void> {
  if (hasBalancesForToday(BANK_IDS.UAF_LIFE)) {
    console.log("✅ Balances already retrieved today. Nothing to do!");
    return;
  }

  await withBrowser(async (page) => {
    await login(
      page,
      process.env.UAF_USERNAME ?? "",
      process.env.UAF_PASSWORD ?? ""
    );

    console.log("💰 Retrieving account balances...");
    const balances = await extractBalances(page);

    const savedPath = saveBalances(BANK_IDS.UAF_LIFE, balances as StoredBalance[]);
    console.log(`💾 Balances saved to: ${savedPath}`);

    console.log("💰 Retrieved balances:");
    for (const { account, balance } of balances) {
      console.log(`  ${account}: ${balance.toLocaleString("fr-FR")} €`);
    }
  });
}

// CLI entry point
if (require.main === module) {
  getBalances().catch((err) => {
    console.error("❌ Failed to get balances:", err);
    process.exit(1);
  });
}
