/**
 * Shared API helper for UAF Life Patrimoine
 *
 * Makes authenticated GET requests to the UAF Life REST API.
 * Authentication is handled via an HttpOnly cookie ("token") on
 * api.uaflife-patrimoine.fr, which Playwright's request context
 * sends automatically — no Bearer token needed.
 */

import { Page } from "playwright";
import { API_BASE } from "./config";

/**
 * Makes an authenticated GET request to the UAF Life API.
 *
 * @param page Playwright page (used for its browser context request)
 * @param path API path relative to API_BASE
 * @returns Parsed JSON response
 */
export async function apiGet(page: Page, path: string): Promise<any> {
  const url = `${API_BASE}${path}`;

  const response = await page.context().request.get(url, {
    headers: {
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
