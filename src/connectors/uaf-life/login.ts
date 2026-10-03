/**
 * Login flow for UAF Life Patrimoine
 *
 * The app (app.uaflife-patrimoine.fr) redirects to an identity provider
 * for authentication. After login, the API authenticates via an HttpOnly
 * cookie named "token" on api.uaflife-patrimoine.fr — NOT via a Bearer
 * token in an Authorization header or browser storage.
 *
 * Since the cookie is HttpOnly, JavaScript cannot read it. Instead, we
 * verify the session is active by making an API call through Playwright's
 * request context, which automatically includes cookies.
 *
 * Flow:
 *   1. Navigate to APP_URL
 *   2. If redirected to identity provider, fill login form
 *   3. Wait for redirect back to the app
 *   4. Verify session via /securite/est_connecte (cookie-based auth)
 */

import { Page } from "playwright";
import { APP_URL, API_BASE, ENDPOINTS, SELECTORS } from "./config";
import { createSpinner } from "../../lib/spinner";

/**
 * Performs the complete login flow for UAF Life.
 *
 * Authentication is cookie-based (HttpOnly "token" cookie on
 * api.uaflife-patrimoine.fr). The Playwright browser context handles
 * cookies automatically, so no token extraction is needed.
 *
 * If the session is already active (persistent context), the login
 * form is skipped entirely.
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
  const spinner = createSpinner("Loading UAF Life app...");
  spinner.start();

  // Navigate to the SPA — it will redirect to the identity provider if not logged in.
  // UAF's edge occasionally drops the TLS handshake; retry once before giving up.
  let lastGotoErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      lastGotoErr = null;
      break;
    } catch (err) {
      lastGotoErr = err;
      console.log(`⚠️ App load attempt ${attempt} failed, retrying...`);
      await page.waitForTimeout(2000);
    }
  }
  if (lastGotoErr) throw lastGotoErr;
  await page.waitForTimeout(2000);

  spinner.stop("🌐 UAF Life app loaded");

  // If the persistent context restored a valid session, the SPA briefly hits
  // the identity provider then redirects back — a URL check is racy against
  // that redirect. Instead, race the login form selector against a stable
  // app-domain URL: whichever wins decides whether we need to log in.
  const detection = await Promise.race([
    page
      .waitForSelector(SELECTORS.usernameInput, { timeout: 15000 })
      .then(() => "login-form" as const)
      .catch(() => "no-form" as const),
    page
      .waitForURL(
        (url) =>
          url.href.startsWith("https://app.uaflife-patrimoine.fr/app") &&
          !url.href.includes("securite"),
        { timeout: 15000 }
      )
      .then(() => "on-app" as const)
      .catch(() => "timeout" as const),
  ]);

  if (detection === "login-form") {
    console.log("📝 Login required — filling credentials");

    try {
      await page.waitForSelector(SELECTORS.loginForm, { timeout: 15000 });
    } catch {
      await page.waitForSelector(SELECTORS.usernameInput, { timeout: 15000 });
    }

    await page.fill(SELECTORS.usernameInput, username);
    await page.waitForTimeout(300);
    await page.fill(SELECTORS.passwordInput, password);
    await page.waitForTimeout(300);
    console.log("🔐 Credentials entered");

    await page.click(SELECTORS.submitButton, { timeout: 10000 });
    console.log("➡️ Login submitted");

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

    // Give the app time to set cookies
    await page.waitForTimeout(2000);

    // Verify the session is active — the cookie is sent automatically by the browser
    const verifyResponse = await page.context().request.get(
      `${API_BASE}${ENDPOINTS.isConnected}`,
      { headers: { Accept: "application/json" } }
    );

    if (!verifyResponse.ok()) {
      throw new Error(
        `Session verification failed: ${verifyResponse.status()} ${verifyResponse.statusText()}`
      );
    }
    console.log("✅ Session verified — authenticated via cookie");
  } else {
    console.log("✅ Already logged in (session restored)");
  }
}
