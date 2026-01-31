/**
 * Login flow for Caisse d'Épargne
 *
 * This bank uses a virtual keyboard for password entry where digits
 * are displayed as images with randomized positions. We use OCR to
 * identify which button corresponds to which digit.
 */

import { Page } from "playwright";
import { LOGIN_URL, DASHBOARD_URL_PATTERN, SELECTORS } from "./config";
import { recognizeAllDigits, terminateOCR } from "../../lib/ocr";
import { withSpinner, createSpinner } from "../../lib/spinner";

/**
 * Extracts base64 image data from button style attributes
 */
function extractBase64Images(styles: (string | null)[]): Buffer[] {
  return styles.map((style, i) => {
    if (!style) {
      throw new Error(`Button ${i} has no style attribute`);
    }
    const match = style.match(/url\("data:image\/png;base64,([^"]+)"\)/);
    if (!match) {
      throw new Error(`Button ${i} has no valid background image`);
    }
    return Buffer.from(match[1], "base64");
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
 * Inputs password using the virtual keyboard
 */
async function inputPassword(password: string, page: Page): Promise<void> {
  const buttons = await page.$$(SELECTORS.keyboardButtonElement);

  if (buttons.length !== 10) {
    throw new Error(`Expected 10 keyboard buttons, found ${buttons.length}`);
  }

  // Extract all button background images
  const styles = await Promise.all(
    buttons.map((button) => button.getAttribute("style"))
  );
  const imageBuffers = extractBase64Images(styles);

  // Run OCR on all images in parallel
  const digits = await withSpinner(
    "Running OCR on keyboard buttons...",
    () => recognizeAllDigits(imageBuffers),
    "🔍 OCR complete"
  );

  // Terminate OCR worker to free resources
  await terminateOCR();

  // Build digit-to-button mapping
  const digitToButton = buildDigitToButtonMap(digits);

  // Click buttons in password order
  for (const char of password) {
    const targetDigit = parseInt(char, 10);
    const buttonIndex = digitToButton.get(targetDigit);

    if (buttonIndex === undefined) {
      throw new Error(`Digit ${targetDigit} not found on virtual keyboard`);
    }

    await buttons[buttonIndex].click();
    await page.waitForTimeout(50);
  }
}

/**
 * Performs the complete login flow
 *
 * @returns API response data containing account information
 */
export async function login(
  page: Page,
  userId: string,
  password: string
): Promise<any> {
  // Navigate to login page
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  console.log("🌐 Page loaded");

  // Click "Espace personnel" to access login
  await page.click(SELECTORS.loginButton, { timeout: 20000 });
  await page.waitForSelector(SELECTORS.identifierInput, { timeout: 20000 });
  console.log("➡️ Navigated to login page");

  // Enter user identifier
  await page.click(SELECTORS.identifierInput);
  await page.keyboard.type(userId, { delay: 30 });
  await page.click(SELECTORS.identifierSubmit);
  await page.waitForSelector(SELECTORS.keyboardButton, { timeout: 20000 });
  console.log("➡️ Submitted user ID");

  // Enter password via virtual keyboard
  console.log("🔐 Entering password via virtual keyboard...");
  await inputPassword(password, page);

  // Set up listener for API response BEFORE submitting
  const apiResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("augmentedSynthesisViews") &&
      response.status() === 200,
    { timeout: 120000 }
  );

  // Submit password
  await page.click(SELECTORS.passwordSubmit, { timeout: 10000 });

  // Wait for dashboard (may require 2FA approval)
  const spinner = createSpinner("Waiting for login (2FA may be required)...");
  spinner.start();
  try {
    await page.waitForURL(DASHBOARD_URL_PATTERN, { timeout: 120000 });
    spinner.stop("✅ Login successful");
  } catch (error) {
    spinner.stop();
    throw error;
  }

  // Return the captured API response
  const apiResponse = await apiResponsePromise;
  return await apiResponse.json();
}
