/**
 * Transaction extraction for Swile
 *
 * GET banking-api.swile.co/api/v0/payments_history with cursor pagination:
 * pass `before=<ISO datetime>` and page backwards from tomorrow until an
 * empty page. The API excludes the exact datetime passed, so the oldest
 * transaction's executed_at is the next cursor (faster than page= offsets).
 *
 * This endpoint is the meal-voucher wallet ledger: `amount.value` is the
 * signed voucher movement (negative = spend, positive = credit), so no
 * per-detail reconstruction is needed.
 *
 * Types observed:
 *   PAYMENT             → card payment at a merchant     (negative)
 *   MEAL_VOUCHER_CREDIT → employer top-up / refund       (positive)
 *   MEAL_VOUCHER_RENEWAL / _EXPIRATION → yearly rollover  (either sign)
 *
 * Declined payments (declined_at set) are skipped.
 */

import { ENDPOINTS, HISTORY_PAGE_SIZE, MAX_PAGES } from "./config";
import { apiHeaders } from "./auth";

interface Payment {
  transaction_number?: string;
  name?: string | null;
  type?: string | null;
  executed_at?: string;
  created_at?: string;
  declined_at?: string | null;
  amount?: { value?: number };
  refunding_transaction?: Payment;
}

export interface SwileTransaction {
  date: string; // ISO datetime
  amount: number; // signed: negative = spend, positive = credit
  title: string;
  type: string;
  transactionId: string;
}

export const CSV_HEADER = [
  "date",
  "amount",
  "title",
  "type",
  "status",
  "transaction_id",
].join(";");

function toCsvLine(t: SwileTransaction): string {
  const d = new Date(t.date);
  const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
  const esc = (s: string) => s.replace(/;/g, ",").replace(/\n/g, " ");
  return [
    dateStr,
    t.amount.toFixed(2),
    esc(t.title),
    esc(t.type),
    "settled",
    esc(t.transactionId),
  ].join(";");
}

function parsePayment(p: Payment): SwileTransaction | null {
  if (!p.transaction_number || p.declined_at) return null;

  const amount = Number(p.amount?.value ?? NaN);
  if (Number.isNaN(amount) || amount === 0) return null;

  const type = p.type ?? "PAYMENT";
  return {
    date: p.executed_at ?? p.created_at ?? "",
    amount,
    title: p.name ?? type,
    type,
    transactionId: p.transaction_number,
  };
}

/** Fetches the full payments history, newest → oldest. */
export async function fetchAllTransactions(
  token: string
): Promise<SwileTransaction[]> {
  const transactions: SwileTransaction[] = [];
  const seen = new Set<string>();
  // Start from tomorrow so today's transactions are included
  let before = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(ENDPOINTS.paymentsHistory);
    url.searchParams.set("per", String(HISTORY_PAGE_SIZE));
    url.searchParams.set("before", before);

    const res = await fetch(url, { headers: apiHeaders(token) });
    if (!res.ok) {
      throw new Error(
        `payments_history failed (${res.status}): ${await res.text()}`
      );
    }
    const json = (await res.json()) as { payments_history?: Payment[] };
    const payments = json.payments_history ?? [];
    if (payments.length === 0) break;

    let oldestCursor = before;
    for (const p of payments) {
      if (p.refunding_transaction) {
        const refund = parsePayment(p.refunding_transaction);
        if (refund && !seen.has(refund.transactionId)) {
          seen.add(refund.transactionId);
          transactions.push(refund);
        }
      }
      const t = parsePayment(p);
      if (t && !seen.has(t.transactionId)) {
        seen.add(t.transactionId);
        transactions.push(t);
      }

      const cursor = p.executed_at ?? p.created_at;
      if (cursor && cursor < oldestCursor) oldestCursor = cursor;
    }

    if (oldestCursor === before) break; // cursor didn't advance — stop
    before = oldestCursor;
    if (payments.length < HISTORY_PAGE_SIZE) break;
  }

  return transactions;
}

export interface TransactionResult {
  accountName: string;
  csvContent: string;
  startDate: string;
}

export async function extractTransactions(
  token: string
): Promise<TransactionResult[]> {
  const items = await fetchAllTransactions(token);
  if (items.length === 0) return [];

  console.log(`Found ${items.length} transaction(s)`);

  const csvLines = [CSV_HEADER, ...items.map(toCsvLine)];
  const oldest = items[items.length - 1];
  const startDate = new Date(oldest.date).toISOString().split("T")[0];

  return [
    {
      accountName: "Meal vouchers",
      csvContent: csvLines.join("\n"),
      startDate,
    },
  ];
}
