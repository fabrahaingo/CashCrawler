/**
 * Shared API helper for UAF Life Patrimoine
 *
 * Makes authenticated GET requests to the UAF Life REST API.
 * Used by both balances.ts and transactions.ts.
 *
 * The API lives on a separate subdomain (api.uaflife-patrimoine.fr)
 * from the SPA (app.uaflife-patrimoine.fr), so page.context().request.get()
 * works correctly — it makes a direct HTTP call, not routed through the SPA.
 */

import { Page } from "playwright";
import { API_BASE } from "./config";

/**
 * Makes an authenticated GET request to the UAF Life API.
 *
 * @param page Playwright page (used for its browser context request)
 * @param path API path relative to API_BASE
 * @param token Bearer token
 * @returns Parsed JSON response
 */
export async function apiGet(page: Page, path: string, token: string): Promise<any> {
  const url = `${API_BASE}${path}`;

  const response = await page.context().request.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok()) {
    throw new Error(
      `API request failed: ${response.status()} ${response.statusText()} for ${path}`
    );
  }

  // Verify we got JSON, not HTML
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.includes("json")) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(
      `Unexpected content-type "${contentType}" for ${path} — ${body}`
    );
  }

  return response.json();
}
