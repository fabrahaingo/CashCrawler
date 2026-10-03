/**
 * Login flow for Sumeria
 *
 * Uses Playwright to automate the web login:
 *   1. Navigate to app.sumeria.eu/login
 *   2. Enter phone number
 *   3. Click "Continuer"
 *   4. Wait for 6-digit OTP code (sent to Sumeria mobile app)
 *   5. Enter code into the input fields
 *   6. Intercept the JWT access_token from the /oauth/otp/_verify response
 *
 * After login, we extract the Bearer token and use direct API calls
 * (no more browser needed).
 */

import { Page } from "playwright";
import { LOGIN_URL } from "./config";
import { promptForCode } from "../../lib/two-factor";
import { createSpinner } from "../../lib/spinner";

/**
 * Performs the complete login flow and returns the JWT access token.
 *
 * @param page Playwright page instance
 * @param phone Phone number in international format (e.g., "+33600000000")
 * @returns JWT access token for API calls
 */
export async function login(page: Page, phone: string): Promise<string> {
  let accessToken: string | null = null;

  // Intercept the OAuth verify response to extract the JWT token
  page.on("response", async (response) => {
    if (response.url().includes("/oauth/otp/_verify") && response.status() === 200) {
      try {
        const body = await response.json();
        accessToken = body.oauth?.access_token ?? null;
      } catch {
        // Ignore parse errors
      }
    }
  });

  // Navigate to login page
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Check if already logged in (session restored from persistent context)
  if (!page.url().includes("/login")) {
    // Already logged in — we need the token from a different source
    // Try to extract from localStorage or make a test API call
    throw new Error(
      "Session restored but no JWT token available. " +
      "Clear browser state and re-login."
    );
  }

  console.log("🌐 Login page loaded");

  // Enter phone number
  const phoneInput = await page.waitForSelector('input[type="tel"]', {
    timeout: 10000,
  });
  const phoneNumber = phone.replace(/^\+33/, "");
  await phoneInput.click();
  await phoneInput.fill(phoneNumber);
  await page.waitForTimeout(500);
  console.log("📱 Phone number entered");

  // Click "Continuer"
  await page.click('button:has-text("Continuer")');
  console.log("➡️ Phone submitted");

  // Wait for code input fields to appear
  await page.waitForSelector('input[maxlength="1"]', {
    state: "visible",
    timeout: 15000,
  });
  console.log("🔐 OTP code input ready — check your Sumeria app");

  // Get OTP code: from environment variable (for automation) or interactive prompt
  const code = process.env.SUMERIA_OTP
    ? process.env.SUMERIA_OTP
    : await promptForCode("🔐 Enter the 6-digit code from your Sumeria app: ");

  if (process.env.SUMERIA_OTP) {
    console.log("🔐 Using OTP code from SUMERIA_OTP env var");
  }

  // Type the code via keyboard into the first input field.
  // These are React-controlled single-digit inputs that auto-advance
  // on each keystroke — fill() doesn't trigger the React handlers,
  // so we click the first input and type the full code character by character.
  const firstInput = await page.$('input[maxlength="1"]');
  if (!firstInput) {
    throw new Error("Could not find OTP code input");
  }
  await firstInput.click();
  await page.keyboard.type(code, { delay: 80 });
  console.log("✅ OTP code entered");

  // Click "Continuer" to submit the code (if a submit button is visible)
  try {
    await page.click('button:has-text("Continuer")', { timeout: 3000 });
    console.log("➡️ OTP submitted");
  } catch {
    // Auto-submit after last digit — no button needed
  }

  // Wait for login to complete (page navigates away from /login)
  const spinner = createSpinner("Waiting for authentication...");
  spinner.start();
  try {
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 30000,
    });
    spinner.stop("✅ Login successful");
  } catch {
    spinner.stop();
    throw new Error("Login failed: page did not redirect after OTP verification");
  }

  // Verify we got the token
  if (!accessToken) {
    // Wait a moment for the response handler to fire
    await page.waitForTimeout(2000);
  }

  if (!accessToken) {
    throw new Error("Login succeeded but failed to capture JWT access token");
  }

  return accessToken;
}
