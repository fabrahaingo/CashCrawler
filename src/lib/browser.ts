/**
 * Shared browser utilities
 *
 * Provides a consistent way to launch and manage browser instances
 * across all bank connectors.
 *
 * Features:
 * - Stealth mode (anti-bot-detection evasion)
 * - Debug mode: set DEBUG_BROWSER=1 for visible browser + slowMo
 * - Persistent context: stores cookies/localStorage to disk so that
 *   device trust (2FA) survives across runs
 */

import { chromium } from "playwright-extra";
import { Page, BrowserContext } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";

const isDebug = process.env.DEBUG_BROWSER === "1";
const SCREENSHOT_DIR = path.join("data", ".temp");
const STORAGE_DIR = path.join("data", ".browser");

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
 * Gets the path to the storage state file for a given connector
 */
function getStoragePath(connectorId: string): string {
  return path.join(STORAGE_DIR, `${connectorId}-state.json`);
}

/**
 * Saves browser storage state (cookies, localStorage) to disk
 */
async function saveStorageState(
  context: BrowserContext,
  connectorId: string
): Promise<void> {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    await context.storageState({ path: getStoragePath(connectorId) });
  } catch {
    // Silently ignore save errors
  }
}

/**
 * Loads saved storage state if it exists
 */
function loadStorageState(
  connectorId: string
): string | undefined {
  const storagePath = getStoragePath(connectorId);
  if (fs.existsSync(storagePath)) {
    return storagePath;
  }
  return undefined;
}

export interface BrowserOptions {
  /**
   * Connector identifier for persistent storage (e.g., "bd", "ce").
   * When set, cookies and localStorage are saved to disk after each
   * session and restored on the next run. This allows device trust
   * (2FA) to persist across runs.
   */
  persistContext?: string;
}

/**
 * Executes a function with a managed browser instance
 *
 * Automatically handles browser launch and cleanup, ensuring
 * the browser is always closed even if an error occurs.
 * Takes a screenshot on failure for debugging.
 *
 * @param fn Function to execute with the page
 * @param options Optional configuration (e.g., persistent context)
 * @returns Result of the function
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>,
  options?: BrowserOptions
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

  // Restore saved storage state if persistent context is enabled
  const storageState = options?.persistContext
    ? loadStorageState(options.persistContext)
    : undefined;

  const context = await browser.newContext({
    hasTouch: true,
    ...(storageState && { storageState }),
  });

  const page = await context.newPage();

  try {
    const result = await fn(page);
    return result;
  } catch (error) {
    await saveScreenshot(page, "error");
    throw error;
  } finally {
    // Always save storage state when persistent context is enabled.
    // This ensures device trust cookies are preserved even if
    // a later step (e.g., balance extraction) fails.
    if (options?.persistContext) {
      await saveStorageState(context, options.persistContext);
    }
    await browser.close();
  }
}
