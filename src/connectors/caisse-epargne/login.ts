/**
 * Login flow for Caisse d'Épargne
 *
 * This bank uses a virtual keyboard for password entry where digits
 * are displayed as images with randomized positions. We use OCR to
 * identify which button corresponds to which digit.
 *
 * Flow:
 * 1. Navigate to login page
 * 2. Enter user identifier
 * 3. Use OCR to map virtual keyboard buttons to digits
 * 4. Click buttons in password order
 * 5. Wait for 2FA if required (up to 2 minutes)
 * 6. Capture API response with account data
 */

import { Page } from "playwright";
import fs from "fs";
import { LOGIN_URL, DASHBOARD_URL_PATTERN, SELECTORS } from "./config";
import { recognizeDigit, cleanDigitMap } from "../../lib/ocr";
import { getTempFilePath, cleanupTempDir } from "../../lib/storage";
import { withSpinner, createSpinner } from "../../lib/spinner";

/**
 * Inputs password using the virtual keyboard
 *
 * The keyboard displays 10 buttons (0-9) with randomized positions.
 * Each button has a background image containing the digit. We:
 * 1. Extract all button images
 * 2. Run OCR in parallel to identify each digit
 * 3. Click buttons in the order specified by the password
 */
async function inputPassword(password: string, page: Page): Promise<void> {
  const buttons = await page.$$(SELECTORS.keyboardButtonElement);

  if (buttons.length !== 10) {
    throw new Error(`Expected 10 keyboard buttons, found ${buttons.length}`);
  }

  // Extract all button background images in parallel
  const styles = await Promise.all(
    buttons.map((button) => button.getAttribute("style"))
  );

  // Save images to temp directory for OCR
  const imageFiles = await Promise.all(
    styles.map(async (style, i) => {
      if (!style) {
        throw new Error(`Button ${i} has no style attribute`);
      }

      const match = style.match(/url\("data:image\/png;base64,([^"]+)"\)/);
      if (!match) {
        throw new Error(`Button ${i} has no valid background image`);
      }

      const filename = getTempFilePath(`button${i}.png`);
      await fs.promises.writeFile(filename, match[1], "base64");
      return filename;
    })
  );

  // Run OCR on all images in parallel for speed
  const ocrResults = await withSpinner(
    "Running OCR on keyboard buttons...",
    () =>
      Promise.all(
        imageFiles.map(async (filename, index) => {
          const digit = await recognizeDigit(filename);
          return { index, digit };
        })
      ),
    "🔍 OCR complete"
  );

  // Build and clean the digit map
  let digitMap: Record<number, number> = {};
  for (const { index, digit } of ocrResults) {
    digitMap[index] = digit;
  }
  digitMap = cleanDigitMap(digitMap);

  // Clean up temp files
  cleanupTempDir();

  // Click buttons in password order
  for (const char of password) {
    const targetDigit = parseInt(char, 10);
    const buttonIndex = Object.keys(digitMap).find(
      (key) => digitMap[Number(key)] === targetDigit
    );

    if (buttonIndex === undefined) {
      throw new Error(`Digit ${targetDigit} not found on virtual keyboard`);
    }

    await buttons[Number(buttonIndex)].click();
    await page.waitForTimeout(150); // Small delay between clicks
  }
}

/**
 * Performs the complete login flow
 *
 * @param page Playwright page instance
 * @param userId User identifier (account number)
 * @param password Password (digits only)
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
  await page.waitForLoadState("networkidle");
  console.log("➡️ Navigated to login page");

  // Enter user identifier
  await page.click(SELECTORS.identifierInput, { timeout: 20000 });
  await page.keyboard.type(userId, { delay: 50 });
  await page.click(SELECTORS.identifierSubmit, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  console.log("➡️ Submitted user ID");

  // Wait for virtual keyboard and enter password
  await page.waitForSelector(SELECTORS.keyboardButton, { timeout: 20000 });
  console.log("🔐 Entering password via virtual keyboard...");
  await inputPassword(password, page);

  // Set up listener for API response BEFORE submitting
  // This captures account data when the dashboard loads
  const apiResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("augmentedSynthesisViews") &&
      response.status() === 200,
    { timeout: 120000 }
  );

  // Submit password
  await page.click(SELECTORS.passwordSubmit, { timeout: 10000 });
  await page.waitForLoadState("networkidle");

  // Wait for dashboard (may require 2FA approval on mobile app)
  const spinner = createSpinner("Waiting for login (2FA may be required)...");
  spinner.start();
  try {
    await page.waitForURL(DASHBOARD_URL_PATTERN, { timeout: 120000 });
    await page.waitForLoadState("networkidle");
    spinner.stop("✅ Login successful");
  } catch (error) {
    spinner.stop();
    throw error;
  }

  // Return the captured API response
  const apiResponse = await apiResponsePromise;
  return await apiResponse.json();
}
