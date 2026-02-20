/**
 * Run All Connectors
 *
 * Executes balances and transactions for all configured bank connectors
 * sequentially: Caisse d'Épargne → UAF Life → Bourse Direct.
 *
 * Each operation is wrapped in try/catch so a failure in one connector
 * doesn't prevent the others from running.
 *
 * Usage:
 *   npm run all
 */

import "dotenv/config";

import {
  getBalances as getCEBalances,
  getTransactions as getCETransactions,
} from "./connectors/caisse-epargne/index";

import {
  getBalances as getUAFBalances,
  getTransactions as getUAFTransactions,
} from "./connectors/uaf-life/index";

import {
  getBalances as getBDBalances,
  getTransactions as getBDTransactions,
} from "./connectors/bourse-direct/index";

// =============================================================================
// TYPES
// =============================================================================

interface OperationResult {
  connector: string;
  operation: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// RUNNER
// =============================================================================

/**
 * Runs a single operation, catching and logging any errors.
 */
async function runOperation(
  connector: string,
  operation: string,
  fn: () => Promise<void>
): Promise<OperationResult> {
  const label = `${connector} / ${operation}`;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log("=".repeat(60));

  try {
    await fn();
    console.log(`✅ ${label} — done`);
    return { connector, operation, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${label} — failed: ${message}`);
    return { connector, operation, success: false, error: message };
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log("🚀 CashCrawler — running all connectors\n");
  const startTime = Date.now();

  const results: OperationResult[] = [];

  // =========================================================================
  // Caisse d'Épargne
  // =========================================================================

  results.push(
    await runOperation("Caisse d'Épargne", "balances", getCEBalances)
  );
  results.push(
    await runOperation("Caisse d'Épargne", "transactions", getCETransactions)
  );

  // =========================================================================
  // UAF Life
  // =========================================================================

  results.push(
    await runOperation("UAF Life", "balances", getUAFBalances)
  );
  results.push(
    await runOperation("UAF Life", "transactions", getUAFTransactions)
  );

  // =========================================================================
  // Bourse Direct
  // =========================================================================

  results.push(
    await runOperation("Bourse Direct", "balances", getBDBalances)
  );
  results.push(
    await runOperation("Bourse Direct", "transactions", getBDTransactions)
  );

  // =========================================================================
  // Summary
  // =========================================================================

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Summary");
  console.log("=".repeat(60));

  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    const suffix = r.error ? ` (${r.error})` : "";
    console.log(`  ${icon} ${r.connector} / ${r.operation}${suffix}`);
  }

  console.log(
    `\n⏱️  Completed in ${elapsed}s — ${succeeded} succeeded, ${failed} failed`
  );

  // Exit with non-zero if any operation failed
  if (failed > 0) {
    process.exit(1);
  }
}

main();
