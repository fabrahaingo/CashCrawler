/**
 * Login flow for UAF Life Patrimoine
 *
 * The new app (app.uaflife-patrimoine.fr) is a SPA that redirects to an
 * identity provider for authentication. After login, the app stores a
 * Bearer token in sessionStorage which is used for all API calls.
 *
 * Flow:
 *   1. Navigate to APP_URL
 *   2. If redirected to identity provider, fill login form
 *   3. Wait for redirect back to the app
 *   4. Extract Bearer token from sessionStorage
 *   5. Verify token via /securite/est_connecte
 */

import { Page } from "playwright";
import { APP_URL, API_BASE, ENDPOINTS, SELECTORS } from "./config";
import { createSpinner } from "../../lib/spinner";

/**
 * Performs the complete login flow for UAF Life and returns the Bearer token.
 *
 * If the session is already active (persistent context), the token is
 * extracted immediately without going through the login form.
 *
 * @param page Playwright page instance
 * @param username User identifier
 * @param password User password
 * @returns Bearer token string for API calls
 */
export async function login(
  page: Page,
  username: string,
  password: string
): Promise<string> {
  const spinner = createSpinner("Loading UAF Life app...");
  spinner.start();

  // Navigate to the SPA — it will redirect to the identity provider if not logged in
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  spinner.stop("🌐 UAF Life app loaded");

  // Check if we landed on the app (already logged in) or on the login form
  const currentUrl = page.url();
  const isOnApp = currentUrl.startsWith("https://app.uaflife-patrimoine.fr");
  const isOnLoginPage = currentUrl.includes("securite") || currentUrl.includes("login");

  if (isOnLoginPage || !isOnApp) {
    console.log("📝 Login required — filling credentials");

    // Wait for the login form to appear
    // The identity provider may use the same selectors, or a standard form
    try {
      await page.waitForSelector(SELECTORS.loginForm, { timeout: 15000 });
    } catch {
      // Fallback: wait for any username input
      await page.waitForSelector(SELECTORS.usernameInput, { timeout: 15000 });
    }

    // Fill credentials
    await page.fill(SELECTORS.usernameInput, username);
    await page.waitForTimeout(300);
    await page.fill(SELECTORS.passwordInput, password);
    await page.waitForTimeout(300);
    console.log("🔐 Credentials entered");

    // Submit the form
    await page.click(SELECTORS.submitButton, { timeout: 10000 });
    console.log("➡️ Login submitted");

    // Wait for redirect back to the app
    const redirectSpinner = createSpinner("Waiting for authentication...");
    redirectSpinner.start();

    try {
      await page.waitForURL(
        (url) => url.href.startsWith("https://app.uaflife-patrimoine.fr/app"),
        { timeout: 30000 }
      );
      redirectSpinner.stop("✅ Redirected to app");
    } catch (error) {
      redirectSpinner.stop();
      throw new Error(
        `Login failed: did not redirect to app. Current URL: ${page.url()}`
      );
    }

    // Give the SPA time to initialize and store the token
    await page.waitForTimeout(3000);
  } else {
    console.log("✅ Already logged in (session restored)");
  }

  // Extract the Bearer token from sessionStorage
  const token = await page.evaluate(() => sessionStorage.getItem("token"));

  if (!token) {
    throw new Error(
      "Could not extract Bearer token from sessionStorage. " +
        "The app may use a different storage key."
    );
  }

  console.log("🔑 Bearer token extracted from sessionStorage");

  // Verify the token works by calling the isConnected endpoint
  const verifyResponse = await page.context().request.get(
    `${API_BASE}${ENDPOINTS.isConnected}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!verifyResponse.ok()) {
    throw new Error(
      `Token verification failed: ${verifyResponse.status()} ${verifyResponse.statusText()}`
    );
  }

  console.log("✅ Token verified — session is active");

  return token;
}
