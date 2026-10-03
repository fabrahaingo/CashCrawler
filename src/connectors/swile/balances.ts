/**
 * Balance extraction for Swile
 *
 * GET employee-bff-api.swile.co/api/wallets/get-wallets returns every
 * wallet on the account (meal vouchers, mobility, personal…) with its
 * current balance and daily spendable ceiling.
 *
 * Only activated, non-zero wallets are reported; the meal-voucher wallet
 * is the one that matters for the finance app.
 */

import { ENDPOINTS } from "./config";
import { apiHeaders } from "./auth";
import { AccountBalance } from "../../lib/types";

interface Money {
  value?: number;
  currency?: { iso3?: string };
}

interface Wallet {
  id?: string;
  type?: string; // "meal_voucher" | "mobility" | "currency" | ...
  label?: string;
  balance?: Money;
  dailyAvailableBalance?: Money;
  isActivated?: boolean;
}

export interface WalletsResponse {
  wallets?: Wallet[];
}

export async function fetchWallets(token: string): Promise<Wallet[]> {
  const res = await fetch(ENDPOINTS.getWallets, {
    headers: { ...apiHeaders(token), "X-API-Version": "0" },
  });
  if (!res.ok) {
    throw new Error(`get-wallets failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as WalletsResponse;
  return json.wallets ?? [];
}

export async function extractBalances(token: string): Promise<AccountBalance[]> {
  const wallets = await fetchWallets(token);
  const balances: AccountBalance[] = [];

  for (const w of wallets) {
    const value = Number(w.balance?.value ?? NaN);
    if (Number.isNaN(value)) continue;
    // Report the meal-voucher wallet always (it's the tracked one); other
    // wallets only when they hold money, so zero mobility/personal wallets
    // don't clutter the snapshot.
    if (w.type !== "meal_voucher" && value === 0) continue;

    const label =
      w.type === "meal_voucher" ? "Meal vouchers" : w.label ?? w.type ?? "Wallet";
    balances.push({ account: label, balance: value });

    if (w.type === "meal_voucher") {
      const daily = Number(w.dailyAvailableBalance?.value ?? NaN);
      if (!Number.isNaN(daily)) {
        console.log(`  (daily spendable ceiling: ${daily.toLocaleString("fr-FR")} €)`);
      }
    }
  }

  return balances;
}
