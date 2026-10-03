/**
 * API discovery for Caisse d'Épargne
 *
 * One-off helper to find which API call backs a page of the CE web app
 * (first use: "Opérations carte en cours", the pending card operations that
 * the PFM API doesn't return).
 *
 * Logs in with a visible browser, then records every JSON response from the
 * CE API hosts while the user navigates by hand. Closing the window (or the
 * timeout) ends the recording; the log is written to data/.temp/. Request
 * headers are never saved, so the auth token stays out of the file.
 */

import fs from "fs";
import path from "path";
import { Page, Response } from "playwright";

const OUTPUT_DIR = path.join("data", ".temp");
const API_HOST = /caisse-epargne\.fr/;
const MAX_BODY_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Words that suggest a response is about pending card operations */
const HINTS = /en ?cours|pending|coming|differ|autori[sz]|card|carte|encours|upcoming|waiting/i;

interface RecordedCall {
  at: string;
  method: string;
  url: string;
  status: number;
  hint: boolean;
  body: unknown;
}

async function record(response: Response, calls: RecordedCall[]): Promise<void> {
  const url = response.url();
  if (!API_HOST.test(url)) return;
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("json")) return;

  let text = "";
  try {
    text = await response.text();
  } catch {
    return; // body gone (redirect, navigation)
  }

  let body: unknown = text.slice(0, MAX_BODY_CHARS);
  try {
    body = JSON.parse(text);
    if (text.length > MAX_BODY_CHARS) body = { truncated: true, preview: text.slice(0, MAX_BODY_CHARS) };
  } catch {
    // keep the raw text preview
  }

  const hint = HINTS.test(url) || HINTS.test(text.slice(0, MAX_BODY_CHARS));
  calls.push({
    at: new Date().toISOString(),
    method: response.request().method(),
    url,
    status: response.status(),
    hint,
    body,
  });
  console.log(`  ${hint ? "⭐" : "·"} ${response.request().method()} ${response.status()} ${url.split("?")[0]}`);
}

/**
 * Records CE API responses until the window is closed or the timeout hits.
 * Call right after login(), with a visible browser (DEBUG_BROWSER=1).
 */
export async function discoverApiCalls(page: Page, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const calls: RecordedCall[] = [];
  const pending: Promise<void>[] = [];
  page.context().on("response", (response) => {
    pending.push(record(response, calls));
  });

  console.log("");
  console.log("🔎 Recording CE API calls. In the browser window:");
  console.log("   1. Open the checking account (Compte individuel)");
  console.log("   2. Open « Opérations carte en cours »");
  console.log("   3. Close the window when the pending operations are on screen");
  console.log(`   (stops automatically after ${Math.round(timeoutMs / 60_000)} min)`);
  console.log("");

  await Promise.race([
    page.waitForEvent("close", { timeout: 0 }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  await Promise.allSettled(pending);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `ce-discover-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(calls, null, 2));

  const hinted = calls.filter((c) => c.hint).length;
  console.log("");
  console.log(`💾 ${calls.length} API responses saved to ${file} (${hinted} flagged ⭐)`);
  return file;
}
