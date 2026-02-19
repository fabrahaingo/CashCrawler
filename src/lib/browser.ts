/**
 * Shared browser utilities
 *
 * Provides a consistent way to launch and manage browser instances
 * across all bank connectors.
 *
 * Set DEBUG_BROWSER=1 to launch in visible (non-headless) mode
 * with slower interactions for easier debugging.
 */

import { chromium } from "playwright-extra";
import { Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";

const isDebug = process.env.DEBUG_BROWSER === "1";
const SCREENSHOT_DIR = path.join("data", ".temp");

/**
 * Saves a screenshot for debugging purposes
 */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const filePath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`📸 Screenshot saved: ${filePath}`);
  } catch {
    // Silently ignore screenshot errors
  }
}

/**
 * Executes a function with a managed browser instance
 *
 * Automatically handles browser launch and cleanup, ensuring
 * the browser is always closed even if an error occurs.
 * Takes a screenshot on failure for debugging.
 *
 * @param fn Function to execute with the page
 * @returns Result of the function
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>
): Promise<T> {
  if (isDebug) {
    console.log("🐛 Debug mode: browser will be visible");
  }

  const browser = await chromium
    .use(StealthPlugin())
    .launch({
      headless: !isDebug,
      ...(isDebug && { slowMo: 50 }),
    });

  const page = await browser.newPage({ hasTouch: true });

  try {
    return await fn(page);
  } catch (error) {
    await saveScreenshot(page, "error");
    throw error;
  } finally {
    await browser.close();
  }
}
