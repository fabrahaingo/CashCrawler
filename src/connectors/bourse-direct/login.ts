/**
 * Login flow for Bourse Direct
 *
 * The site uses a React SPA for authentication. The flow is:
 *   1. Navigate to the login page
 *   2. Dismiss cookie consent banner if present
 *   3. Wait for the React LoginForm to render
 *   4. Fill username + password, submit
 *   5. Handle 2FA if required:
 *      a. Select "trust this device" (Oui)
 *      b. Prompt user for 6-digit code via terminal
 *      c. Enter code and submit
 *   6. Wait for redirect to post-login page
 *
 * The login is an AJAX call — the URL stays on /fr/login until
 * authentication is fully complete (including 2FA). The 2FA modal
 * is a React portal rendered on the same page.
 *
 * Device trust is persisted via browser storage state (cookies),
 * so 2FA should only be required on the first run.
 */

import { Page } from "playwright";
import {
  LOGIN_URL,
  SELECTORS,
} from "./config";
import { promptForCode } from "../../lib/two-factor";
import { createSpinner } from "../../lib/spinner";

/**
 * Dismisses the Didomi cookie consent banner if present
 */
async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    await page.click(SELECTORS.cookieAccept, { timeout: 3000 });
    console.log("🍪 Cookie banner dismissed");
  } catch {
    // Banner not present or already dismissed — that's fine
  }
}

/**
 * Handles the 2FA modal flow
 *
 * Two modes:
 * - Interactive terminal: prompts user for code via stdin, types it in
 * - Non-interactive / visible browser: selects "trust this device",
 *   then waits for the user to manually enter the code in the browser
 */
async function handleTwoFactor(page: Page): Promise<void> {
  console.log("🔐 2FA required — check your authenticator app for a code");

  // Wait for the OTP input to be visible
  await page.waitForSelector(SELECTORS.otpFirstInput, {
    state: "visible",
    timeout: 10000,
  });

  // Select "trust this device" (Oui) so future logins skip 2FA
  try {
    await page.click(SELECTORS.trustDeviceYes, { timeout: 3000 });
    console.log("✅ Selected 'trust this device'");
  } catch {
    // Trust option may not be visible — continue without it
  }

  // Try to prompt for code via stdin. If stdin is not a TTY
  // (e.g., running from a non-interactive shell), fall back to
  // waiting for the user to complete 2FA manually in the browser.
  if (process.stdin.isTTY) {
    const code = await promptForCode("🔐 Enter the 6-digit 2FA code: ");

    // Type the code into the OTP input fields
    // react-code-input auto-advances to the next field on each digit
    await page.click(SELECTORS.otpFirstInput);
    await page.keyboard.type(code, { delay: 50 });
    console.log("✅ 2FA code entered");

    // Submit the 2FA form
    await page.click(SELECTORS.twoFactorSubmit, { timeout: 5000 });
  } else {
    // Non-interactive mode: wait for user to complete 2FA in the browser
    console.log(
      "⏳ Enter the 2FA code directly in the browser window..."
    );
    // Wait for the modal to disappear (user completed 2FA manually)
    await page.waitForSelector(SELECTORS.twoFactorModal, {
      state: "detached",
      timeout: 300000, // 5 minutes
    });
  }
}

/**
 * Performs the complete login flow for Bourse Direct
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
  // Navigate to login page
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  console.log("🌐 Login page loaded");

  // Dismiss cookie banner
  await dismissCookieBanner(page);

  // Check if we're already logged in (persistent cookies from a previous session).
  // If the login form doesn't appear within a few seconds, we're likely already
  // authenticated and the page redirected to the dashboard.
  const loginForm = await page
    .waitForSelector(SELECTORS.usernameInput, { timeout: 5000 })
    .catch(() => null);

  if (!loginForm) {
    // No login form — check if we're on a logged-in page
    const url = page.url();
    if (!url.includes("/fr/login")) {
      console.log("✅ Already logged in (session restored)");
      return;
    }
    // Still on login page but form didn't render — wait longer
    await page.waitForSelector(SELECTORS.usernameInput, { timeout: 25000 });
  }
  console.log("📝 Login form ready");

  // Fill credentials
  await page.fill(SELECTORS.usernameInput, username);
  await page.waitForTimeout(200);
  await page.fill(SELECTORS.passwordInput, password);
  await page.waitForTimeout(200);
  console.log("🔐 Credentials entered");

  // Submit login form
  await page.click(SELECTORS.submitButton, { timeout: 10000 });
  console.log("➡️ Login submitted");

  // The login is an AJAX call. After submit, either:
  //   a) The page redirects (no 2FA) — URL leaves /fr/login
  //   b) A 2FA modal appears on the same page — URL stays /fr/login
  //
  // Race between these two outcomes.
  // Important: the losing promise will eventually reject (timeout).
  // We attach .catch() to each branch so the loser's rejection is
  // silently swallowed instead of becoming an unhandled rejection.
  const result = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.includes("/fr/login"), {
        timeout: 30000,
      })
      .then(() => "logged-in" as const)
      .catch(() => "timeout" as const),
    page
      .waitForSelector(SELECTORS.twoFactorModal, {
        state: "visible",
        timeout: 30000,
      })
      .then(() => "2fa-required" as const)
      .catch(() => "timeout" as const),
  ]);

  if (result === "timeout") {
    throw new Error(
      "Login failed: neither redirect nor 2FA modal appeared within 30 seconds"
    );
  }

  if (result === "2fa-required") {
    await handleTwoFactor(page);

    // After 2FA, wait for the page to redirect
    const spinner = createSpinner("Waiting for 2FA validation...");
    spinner.start();
    try {
      await page.waitForURL(
        (url) => !url.pathname.includes("/fr/login"),
        { timeout: 30000 }
      );
      spinner.stop("✅ Login successful (2FA validated)");
    } catch (error) {
      spinner.stop();
      throw error;
    }
  } else {
    console.log("✅ Login successful (no 2FA required)");
  }
}
