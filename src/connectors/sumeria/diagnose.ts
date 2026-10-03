/**
 * Diagnostic script for Sumeria accounts
 *
 * Logs raw API responses to help debug account listing issues.
 * Run: npx tsx src/connectors/sumeria/diagnose.ts
 */

import "dotenv/config";
import { login } from "./login";
import { ENDPOINTS, HISTORY_PAGE_SIZE } from "./config";
import { withBrowser } from "../../lib/browser";

const REQUEST_TIMEOUT_MS = 15_000;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "x-app-source": "banking-web",
  };
}

async function run() {
  await withBrowser(async (page) => {
    const token = await login(page, process.env.SUMERIA_PHONE ?? "");

    // ── 1. Fetch raw accounts ──────────────────────────────────────────
    console.log("\n════════════════════════════════════════════");
    console.log("  STEP 1: Raw /accounts response");
    console.log("════════════════════════════════════════════\n");

    const accountsResp = await fetch(ENDPOINTS.accounts, {
      headers: headers(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const accountsData = await accountsResp.json();

    for (const item of accountsData.items ?? []) {
      console.log(`── Account: ${item.name || item.display_name} ──`);
      console.log(JSON.stringify(item, null, 2));
      console.log("");
    }

    // ── 2. Try fetching 1 page of transactions per account ─────────────
    console.log("\n════════════════════════════════════════════");
    console.log("  STEP 2: Transaction fetch test (1 page each)");
    console.log("════════════════════════════════════════════\n");

    for (const item of accountsData.items ?? []) {
      const name = item.name || item.display_name;
      const emitterId = item.emitter_id ?? null;
      const lydiaAccountId = item.lydia_account_id ?? item.account_id ?? null;
      const id = item.id;

      console.log(`── ${name} ──`);
      console.log(`   emitter_id:        ${emitterId ?? "MISSING"}`);
      console.log(`   lydia_account_id:  ${lydiaAccountId ?? "MISSING"}`);
      console.log(`   id:                ${id}`);
      console.log(`   type:              ${item.type}`);
      console.log(`   subtype:           ${item.subtype}`);

      // Try with emitter_id first
      if (emitterId) {
        try {
          const body = {
            from: 0,
            size: 3,
            query: {
              bool: {
                must: [{
                  bool: {
                    should: [{
                      multi_match: {
                        query: emitterId,
                        operator: "or",
                        fields: ["emitter.id", "receiver.id"],
                      },
                    }],
                  },
                }],
              },
            },
            extras: { queries: [{ key: "declined_transactions", args: { included: false } }] },
            sort: [{ createdAt: "desc" }],
          };

          const resp = await fetch(ENDPOINTS.historySearch, {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          const data = await resp.json();
          console.log(`   [emitter_id query] → total=${data.total}, items=${(data.items ?? []).length}`);
        } catch (err) {
          console.log(`   [emitter_id query] → ERROR: ${(err as Error).message}`);
        }
      }

      // Try with lydia_account_id
      if (lydiaAccountId) {
        try {
          const body = {
            from: 0,
            size: 3,
            query: {
              bool: {
                must: [{
                  bool: {
                    should: [{
                      match: { lydia_account_id: lydiaAccountId },
                    }],
                  },
                }],
              },
            },
            extras: { queries: [{ key: "declined_transactions", args: { included: false } }] },
            sort: [{ createdAt: "desc" }],
          };

          const resp = await fetch(ENDPOINTS.historySearch, {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          const data = await resp.json();
          console.log(`   [lydia_account_id query] → total=${data.total}, items=${(data.items ?? []).length}`);
        } catch (err) {
          console.log(`   [lydia_account_id query] → ERROR: ${(err as Error).message}`);
        }
      }

      // Try with numeric id
      try {
        const body = {
          from: 0,
          size: 3,
          query: {
            bool: {
              must: [{
                bool: {
                  should: [{
                    multi_match: {
                      query: String(id),
                      operator: "or",
                      fields: ["emitter.id", "receiver.id", "lydia_account_id"],
                    },
                  }],
                },
              }],
            },
          },
          extras: { queries: [{ key: "declined_transactions", args: { included: false } }] },
          sort: [{ createdAt: "desc" }],
        };

        const resp = await fetch(ENDPOINTS.historySearch, {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = await resp.json();
        console.log(`   [id query] → total=${data.total}, items=${(data.items ?? []).length}`);
      } catch (err) {
        console.log(`   [id query] → ERROR: ${(err as Error).message}`);
      }

      console.log("");
    }

    console.log("════════════════════════════════════════════");
    console.log("  DONE");
    console.log("════════════════════════════════════════════");
  });
}

run().catch((err) => {
  console.error("❌ Diagnostic failed:", err.message);
  process.exit(1);
});
