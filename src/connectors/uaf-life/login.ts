/**
 * Login flow for UAF Life Patrimoine
 *
 * Simple form-based login (no virtual keyboard).
 */

import { Page } from "playwright";
import { HOME_URL, DASHBOARD_URL, SELECTORS } from "./config";

/**
 * Performs the complete login flow for UAF Life
 *
 * @param page Playwright page instance
 * @param username User identifier
 * @param password User password
 */
export async function login(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  // Navigate to home page
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  console.log("🌐 Home page loaded");

  // Click connect button
  await page.click(SELECTORS.connectButton, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  console.log("➡️ Clicked connect button");

  // Wait for login form
  await page.waitForSelector(SELECTORS.loginForm, { timeout: 20000 });
  console.log("📝 Login form found");

  // Fill credentials
  await page.fill(SELECTORS.usernameInput, username);
  await page.waitForTimeout(300);
  await page.fill(SELECTORS.passwordInput, password);
  await page.waitForTimeout(300);
  console.log("🔐 Credentials entered");

  // Submit
  await page.click(SELECTORS.submitButton, { timeout: 20000 });
  console.log("➡️ Submitted login form");

  // Wait for dashboard
  await page.waitForURL(DASHBOARD_URL, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  console.log("✅ Logged in successfully");
}
