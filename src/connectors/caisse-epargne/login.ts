/**
 * Login flow for Caisse d'Épargne (ICG Auth)
 *
 * The bank uses an Angular SPA at icgauth.caisse-epargne.fr for login.
 * The flow is:
 *   1. Navigate directly to ICG Auth login page
 *   2. Wait for Angular to render the identifier form
 *   3. Enter user identifier
 *   4. Enter password via virtual keyboard (OCR on button images)
 *   5. Wait for redirect to dashboard
 *   6. Capture the API response with account data
 *
 * The virtual keyboard still uses randomized digit images as button
 * backgrounds, requiring OCR to map buttons to digits.
 */

import { Page } from "playwright";
import {
  LOGIN_URL,
  DASHBOARD_URL_PATTERN,
  SELECTORS,
  KEYBOARD_IMAGE_REGEX,
} from "./config";
import { recognizeAllDigits, terminateOCR } from "../../lib/ocr";
import { withSpinner } from "../../lib/spinner";
import { waitForExternalApproval } from "../../lib/two-factor";

/**
 * Extracts base64 image data from keyboard button style attributes.
 *
 * The new ICG Auth uses inline styles like:
 *   background: center no-repeat url(data:image/png;base64,...)
 *
 * The old system used:
 *   background-image: url("data:image/png;base64,...")
 *
 * We handle both formats.
 */
function extractBase64Images(styles: (string | null)[]): Buffer[] {
  return styles.map((style, i) => {
    if (!style) {
      throw new Error(`Button ${i} has no style attribute`);
    }
    const match = style.match(KEYBOARD_IMAGE_REGEX);
    if (!match) {
      throw new Error(
        `Button ${i} has no valid background image. Style: ${style.slice(0, 100)}`,
      );
    }
    // match[1] is the full data URI: "data:image/png;base64,XXXX"
    const base64Data = match[1].replace(/^data:image\/png;base64,/, "");
    return Buffer.from(base64Data, "base64");
  });
}

/**
 * Builds a map from digit to button index
 */
function buildDigitToButtonMap(digits: number[]): Map<number, number> {
  const map = new Map<number, number>();
  digits.forEach((digit, index) => {
    if (digit >= 0 && digit <= 9) {
      map.set(digit, index);
    }
  });
  return map;
}

/**
 * Validates that OCR produced a valid keyboard mapping.
 * The virtual keyboard always shows exactly digits 0-9, each once.
 * If OCR is correct, we should have a permutation of {0,1,...,9}.
 */
function isValidKeyboardMapping(digits: number[]): boolean {
  if (digits.length !== 10) return false;
  const seen = new Set(digits);
  if (seen.size !== 10) return false;
  for (let i = 0; i <= 9; i++) {
    if (!seen.has(i)) return false;
  }
  return true;
}

/**
 * Inputs password using the virtual keyboard.
 *
 * The OCR layer (ocr.ts) uses confidence-based process-of-elimination
 * to auto-correct misreads. As a second line of defense, if the result
 * is still invalid, we terminate the worker (clearing any cached state),
 * re-read the button images, and retry up to MAX_OCR_RETRIES times.
 */
const MAX_OCR_RETRIES = 3;

async function inputPassword(password: string, page: Page): Promise<void> {
  const buttons = await page.$$(SELECTORS.keyboardButtonElement);

  if (buttons.length !== 10) {
    throw new Error(`Expected 10 keyboard buttons, found ${buttons.length}`);
  }

  let digits: number[] = [];
  let lastError: string = "";

  for (let attempt = 1; attempt <= MAX_OCR_RETRIES; attempt++) {
    // On retry, terminate the worker so a fresh one is created
    if (attempt > 1) {
      await terminateOCR();
      await page.waitForTimeout(500);
    }

    // Extract all button background images
    const styles = await Promise.all(
      buttons.map((button) => button.getAttribute("style")),
    );
    const imageBuffers = extractBase64Images(styles);

    // Run OCR — recognizeAllDigits auto-corrects using confidence scores
    const label = attempt === 1
      ? "Running OCR on keyboard buttons..."
      : `OCR retry ${attempt}/${MAX_OCR_RETRIES}...`;
    digits = await withSpinner(
      label,
      () => recognizeAllDigits(imageBuffers),
      "🔍 OCR complete",
    );

    if (isValidKeyboardMapping(digits)) {
      if (attempt > 1) {
        console.log(`  ✅ OCR succeeded on attempt ${attempt}`);
      }
      break;
    }

    lastError = `OCR returned invalid mapping: [${digits.join(", ")}] (expected permutation of 0-9)`;
    console.log(`  ⚠️ ${lastError}`);
  }

  // Terminate OCR worker to free resources
  await terminateOCR();

  if (!isValidKeyboardMapping(digits)) {
    throw new Error(
      `OCR failed after ${MAX_OCR_RETRIES} attempts. ${lastError}`,
    );
  }

  // Build digit-to-button mapping
  const digitToButton = buildDigitToButtonMap(digits);

  // Click buttons in password order
  for (const char of password) {
    const targetDigit = parseInt(char, 10);
    const buttonIndex = digitToButton.get(targetDigit);

    if (buttonIndex === undefined) {
      // Should never happen after validation, but just in case
      throw new Error(`Digit ${targetDigit} not found on virtual keyboard`);
    }

    await buttons[buttonIndex].click();
    await page.waitForTimeout(50);
  }
}

/**
 * Dismisses the cookie consent modal that ICG Auth shows on first load.
 *
 * The modal renders a full-screen backdrop that intercepts pointer events,
 * so any click on the login form (identifier input, virtual keyboard) times
 * out until it is dismissed. CE Île-de-France uses a Commanders Act
 * (TrustCommander) popup; we prefer "Continuer sans accepter" to avoid
 * storing extra cookies and keep state consistent across runs, falling back
 * to "Tout accepter". Selectors vary, so we try several and ignore failures.
 */
async function dismissCookieBanner(page: Page): Promise<void> {
  const selectors = [
    "#popin_tc_privacy_button_2", // Commanders Act: "Continuer sans accepter"
    'button:has-text("Continuer sans accepter")',
    'a:has-text("Continuer sans accepter")',
    "#popin_tc_privacy_button", // Commanders Act: "Tout accepter"
    'button:has-text("Tout accepter")',
  ];
  for (const sel of selectors) {
    try {
      await page.click(sel, { timeout: 3000 });
      await page.waitForTimeout(500);
      console.log("🍪 Cookie banner dismissed");
      return;
    } catch {
      // Try next selector
    }
  }
  // Banner not present or already dismissed — that's fine
}

export interface LoginResult {
  /** API response data containing account information */
  apiData: any;
  /** Bearer token for direct API calls (captured from bapi requests) */
  authToken: string;
}

/**
 * Performs the complete login flow via ICG Auth
 *
 * @returns Login result with API data and auth token for direct API calls
 */
export async function login(
  page: Page,
  userId: string,
  password: string,
): Promise<LoginResult> {
  // Capture auth token from bapi requests made after login
  let authToken = "";
  page.on("request", (request) => {
    if (request.url().includes("rs-ext-bad-ce")) {
      const auth = request.headers()["authorization"];
      if (auth) authToken = auth;
    }
  });
  // Navigate directly to ICG Auth login page (skip the homepage)
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  console.log("🌐 Page loaded");

  // Wait for Angular SPA to render the identifier form
  // The form may take a moment to render after the initial page load
  await page.waitForSelector(SELECTORS.identifierInput, { timeout: 30000 });
  console.log("➡️ Login form ready");

  // Dismiss the cookie consent modal — its backdrop intercepts pointer
  // events and otherwise makes every form click time out.
  await dismissCookieBanner(page);

  // Enter user identifier
  const identifierInput = await page.$(SELECTORS.identifierInput);
  if (!identifierInput) {
    throw new Error("Could not find identifier input field");
  }
  await identifierInput.click();
  await page.keyboard.type(userId, { delay: 30 });

  // Submit identifier
  await page.click(SELECTORS.identifierSubmit, { timeout: 10000 });

  // Wait for virtual keyboard to appear (password step)
  await page.waitForSelector(SELECTORS.keyboardButton, { timeout: 30000 });
  console.log("➡️ Submitted user ID");

  // Enter password via virtual keyboard
  console.log("🔐 Entering password via virtual keyboard...");
  await inputPassword(password, page);

  // Set up listener for API response BEFORE submitting password
  // The augmentedSynthesisViews API is called after successful login
  const apiResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("augmentedSynthesisViews") &&
      response.status() === 200,
    { timeout: 120000 },
  );

  // Submit password
  await page.click(SELECTORS.passwordSubmit, { timeout: 10000 });

  // Wait for dashboard redirect (may require 2FA approval on first device)
  await waitForExternalApproval(page, DASHBOARD_URL_PATTERN);

  // Capture the API response
  const apiResponse = await apiResponsePromise;
  const apiData = await apiResponse.json();

  // Wait briefly for auth token to be captured from subsequent requests
  if (!authToken) {
    await page.waitForTimeout(3000);
  }

  return { apiData, authToken };
}
