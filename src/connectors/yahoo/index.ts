/**
 * Yahoo Finance price fetcher (stealth)
 *
 * Why this exists: direct curl/fetch against query1.finance.yahoo.com
 * is reliably rate-limited (HTTP 429) from a wide range of IPs, even
 * with browser-like headers. Routing the same chart-API call through
 * a real (stealthed) Chromium with the consent cookies set lets Yahoo
 * treat the traffic as a logged-in browser session.
 *
 * Usage:
 *   SYMBOLS=AIR.PA,MC.PA npm run yahoo:prices
 *
 * Output: data/prices/<YYYY-MM-DD>.json
 *   {
 *     date: "2026-05-24",
 *     prices: [{ symbol, price, currency, fetchedAt }],
 *     errors: [{ symbol, error }]
 *   }
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { withBrowser } from "../../lib/browser";

interface PriceQuote {
  symbol: string;
  price: number;
  currency: string;
  previousClose: number;
  fetchedAt: string;
  /** Historical daily closes from the chart API (sorted ascending by date) */
  history: { date: string; close: number }[];
}

interface FetchError {
  symbol: string;
  error: string;
}

/**
 * Yahoo chart `range` parameter. Pass the larger of:
 *   - the per-symbol range from SYMBOL_RANGES env (set by callers that know the gap)
 *   - RANGE env (single value applied to all symbols)
 *   - default "5d"
 */
function rangeFor(symbol: string, perSymbol: Map<string, string>): string {
  return perSymbol.get(symbol) ?? process.env.RANGE ?? "5d";
}

async function fetchPrices(
  symbols: string[],
  perSymbolRange: Map<string, string>
): Promise<{
  prices: PriceQuote[];
  errors: FetchError[];
}> {
  const prices: PriceQuote[] = [];
  const errors: FetchError[] = [];

  await withBrowser(
    async (page) => {
      // Prime cookies by visiting Yahoo Finance home — accept consent if shown.
      await page.goto("https://finance.yahoo.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);

      // Try to dismiss the consent banner (EU). Selectors vary, so attempt
      // a few common ones and ignore failures.
      const consentSelectors = [
        'button[name="agree"]',
        'button:has-text("Accept all")',
        'button:has-text("Tout accepter")',
        '#consent-page button[type="submit"]',
      ];
      for (const sel of consentSelectors) {
        try {
          await page.click(sel, { timeout: 2000 });
          await page.waitForTimeout(1000);
          break;
        } catch {
          // try next
        }
      }

      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        if (i > 0) await page.waitForTimeout(800);
        try {
          const range = rangeFor(symbol, perSymbolRange);
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
          const response = await page.context().request.get(url, {
            headers: {
              Accept: "*/*",
              Referer: "https://finance.yahoo.com/",
              Origin: "https://finance.yahoo.com",
            },
          });

          if (!response.ok()) {
            errors.push({
              symbol,
              error: `HTTP ${response.status()} ${response.statusText()}`,
            });
            continue;
          }

          const data = await response.json();
          const result = data?.chart?.result?.[0];
          const meta = result?.meta;
          const price = meta?.regularMarketPrice;
          if (typeof price !== "number") {
            errors.push({ symbol, error: "No regularMarketPrice in response" });
            continue;
          }

          // Build historical series: timestamps[] + indicators.quote[0].close[]
          const history: { date: string; close: number }[] = [];
          const timestamps: number[] = result?.timestamp ?? [];
          const closes: (number | null)[] =
            result?.indicators?.quote?.[0]?.close ?? [];
          for (let j = 0; j < timestamps.length; j++) {
            const close = closes[j];
            if (close == null) continue;
            const date = new Date(timestamps[j] * 1000)
              .toISOString()
              .split("T")[0];
            history.push({ date, close });
          }

          prices.push({
            symbol,
            price,
            currency: meta.currency ?? "EUR",
            previousClose: meta.previousClose ?? meta.chartPreviousClose ?? price,
            fetchedAt: new Date().toISOString(),
            history,
          });
        } catch (err) {
          errors.push({ symbol, error: (err as Error).message });
        }
      }
    },
    { persistContext: "yahoo" }
  );

  return { prices, errors };
}

async function main() {
  const symbolsEnv = process.env.SYMBOLS ?? "";
  const symbols = symbolsEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (symbols.length === 0) {
    console.error("❌ No symbols provided. Set SYMBOLS=AIR.PA,MC.PA env var.");
    process.exit(1);
  }

  // SYMBOL_RANGES is optional, format: "AIR.PA:1mo,MC.PA:3mo".
  const perSymbolRange = new Map<string, string>();
  const ranges = process.env.SYMBOL_RANGES ?? "";
  for (const part of ranges.split(",")) {
    const [sym, r] = part.split(":");
    if (sym && r) perSymbolRange.set(sym.trim(), r.trim());
  }

  console.log(`📈 Fetching ${symbols.length} symbol(s) from Yahoo Finance...`);
  const { prices, errors } = await fetchPrices(symbols, perSymbolRange);

  const today = new Date().toISOString().split("T")[0];
  const outDir = path.join("data", "prices");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${today}.json`);

  fs.writeFileSync(
    outPath,
    JSON.stringify({ date: today, prices, errors }, null, 2)
  );

  console.log(`💾 Saved ${prices.length} price(s) to ${outPath}`);
  if (errors.length > 0) {
    console.log(`⚠️ ${errors.length} symbol(s) failed:`);
    for (const e of errors) {
      console.log(`   ${e.symbol}: ${e.error}`);
    }
  }

  for (const p of prices) {
    console.log(`   ${p.symbol}: ${p.price.toFixed(4)} ${p.currency}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
  });
}
