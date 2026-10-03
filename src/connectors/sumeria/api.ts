/**
 * Sumeria API client
 *
 * Direct HTTP client for api.lydia-app.com using a JWT Bearer token.
 * Used after the Playwright login flow extracts the access token.
 *
 * The history/_search endpoint returns rich transaction data including:
 * - PFM categories (major + micro, auto-detected)
 * - Emitter/receiver details (names, types, IDs)
 * - Transaction metadata (type, status, fees, source)
 * - User overrides (custom labels, custom categories)
 */

import { ENDPOINTS, HISTORY_PAGE_SIZE } from "./config";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

export interface SumeriaAccount {
  id: number;
  name: string;
  balance: string;
  emitter_id: string;
  type: string;
  subtype: string;
  currency: string;
  created_at: string;
  iban: string;
}

/** Raw history/_search item — we keep it loosely typed to capture all fields */
export interface HistoryItem {
  id: string;
  amount: number;
  created_at: string;
  updated_at: string;
  title: string;
  subtitle: string;
  type: string;
  status: string;
  source: string;
  fees: number;
  is_self_payment: boolean;
  is_instant: boolean;
  emitter_id: string;
  emitter_type: string;
  receiver_id: string;
  receiver_type: string;
  lydia_account_id: string;
  user_label: string;
  user_category: string;
  pfm_category: string;
  pfm: {
    major_category: { id: string; label: string; emoji: string } | null;
    micro_category: { id: string; label: string; emoji: string } | null;
    user_major_category: { id: string; label: string } | null;
    user_micro_category: { id: string; label: string } | null;
  };
  emitter: { id: string; name: string; type: string };
  receiver: { id: string; name: string; type: string };
  payer: { id: string; name: string } | null;
  recipient: { id: string; name: string } | null;
  group_id: string;
  ref_id: string;
}

// =============================================================================
// HTTP HELPERS
// =============================================================================

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "x-app-source": "banking-web",
  };
}

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds per request

async function apiGet(token: string, url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: headers(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`API GET ${url} failed: ${resp.status} ${resp.statusText}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    return resp.json();
  }
  return resp.text();
}

async function apiPost(token: string, url: string, body: any): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(
      `API POST ${url} failed: ${resp.status} ${resp.statusText}`
    );
  }
  return resp.json();
}

// =============================================================================
// ACCOUNTS
// =============================================================================

/**
 * Fetches all accounts with their current balances.
 */
export async function fetchAccounts(
  token: string
): Promise<SumeriaAccount[]> {
  const data = await apiGet(token, ENDPOINTS.accounts);
  return (data.items ?? []).map((item: any) => ({
    id: item.id,
    name: item.name || item.display_name,
    balance: item.balance,
    emitter_id: item.emitter_id,
    type: item.type,
    subtype: item.subtype,
    currency: item.currency,
    created_at: item.created_at,
    iban: item.iban,
  }));
}

// =============================================================================
// TRANSACTION HISTORY
// =============================================================================

/**
 * Builds the Elasticsearch-like query body for history/_search.
 *
 * The API uses emitter_id (not account id) to filter transactions.
 * We match on both emitter.id and receiver.id to capture both
 * incoming and outgoing transactions for the account.
 */
function buildSearchBody(emitterId: string, from: number, size: number): any {
  return {
    from,
    size,
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                {
                  multi_match: {
                    query: emitterId,
                    operator: "or",
                    fields: ["emitter.id", "receiver.id"],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    extras: {
      queries: [
        {
          key: "declined_transactions",
          args: { included: false },
        },
      ],
    },
    sort: [{ createdAt: "desc" }],
  };
}

/**
 * Fetches ALL transactions for an account by paginating through history/_search.
 *
 * @param token JWT access token
 * @param account The account object (needs emitter_id, lydia_account_id, id)
 * @returns All transaction items
 */
export async function fetchAllTransactions(
  token: string,
  account: SumeriaAccount
): Promise<HistoryItem[]> {
  const allItems: HistoryItem[] = [];
  let from = 0;
  let total = 0;

  const spinner = createSpinner(
    `Fetching transactions for ${account.name}...`
  );
  spinner.start();

  try {
    // First request to get total count
    const firstPage = await apiPost(
      token,
      ENDPOINTS.historySearch,
      buildSearchBody(account.emitter_id, 0, HISTORY_PAGE_SIZE)
    );
    total = firstPage.total ?? 0;
    allItems.push(...(firstPage.items ?? []));
    from = allItems.length;

    // Paginate through remaining pages
    while (from < total) {
      const page = await apiPost(
        token,
        ENDPOINTS.historySearch,
        buildSearchBody(account.emitter_id, from, HISTORY_PAGE_SIZE)
      );
      const items = page.items ?? [];
      if (items.length === 0) break;
      allItems.push(...items);
      from += items.length;
    }

    spinner.stop(
      `  ✓ ${account.name}: ${allItems.length} transactions fetched`
    );
  } catch (error) {
    spinner.stop();
    throw error;
  }

  return allItems;
}

// =============================================================================
// CSV EXPORT
// =============================================================================

/**
 * Rich CSV header with all valuable fields from history/_search.
 *
 * Includes PFM categories (auto-detected + user overrides),
 * emitter/receiver details, transaction metadata, and more.
 */
export const CSV_HEADER = [
  "date",
  "amount",
  "title",
  "subtitle",
  "type",
  "status",
  "source",
  "pfm_category",
  "pfm_major_label",
  "pfm_major_id",
  "pfm_micro_label",
  "pfm_micro_id",
  "user_category",
  "user_label",
  "emitter_name",
  "emitter_type",
  "receiver_name",
  "receiver_type",
  "payer_name",
  "recipient_name",
  "fees",
  "is_self_payment",
  "is_instant",
  "group_id",
  "transaction_id",
].join(";");

/**
 * Converts a history item to a rich CSV line with all PFM and metadata fields.
 */
export function historyItemToCsvLine(item: HistoryItem): string {
  const date = new Date(item.created_at);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;

  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/;/g, ",").replace(/\n/g, " ");

  const pfm = item.pfm ?? {};
  const major = pfm.major_category ?? {};
  const micro = pfm.micro_category ?? {};

  return [
    dateStr,
    item.amount?.toFixed(2) ?? "0.00",
    esc(item.title),
    esc(item.subtitle),
    esc(item.type),
    esc(item.status),
    esc(item.source),
    esc(item.pfm_category),
    esc((major as any).label),
    esc((major as any).id),
    esc((micro as any).label),
    esc((micro as any).id),
    esc(item.user_category),
    esc(item.user_label),
    esc(item.emitter?.name),
    esc(item.emitter_type),
    esc(item.receiver?.name),
    esc(item.receiver_type),
    esc(item.payer?.name),
    esc(item.recipient?.name),
    item.fees ?? 0,
    item.is_self_payment ? "true" : "false",
    item.is_instant ? "true" : "false",
    esc(item.group_id),
    esc(item.id),
  ].join(";");
}
