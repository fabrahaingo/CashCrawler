/**
 * Shared browser utilities
 *
 * Provides a consistent way to launch and manage browser instances
 * across all bank connectors.
 */

import { chromium } from "playwright-extra";
import { Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

/**
 * Executes a function with a managed browser instance
 *
 * Automatically handles browser launch and cleanup, ensuring
 * the browser is always closed even if an error occurs.
 *
 * @param fn Function to execute with the page
 * @returns Result of the function
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await chromium
    .use(StealthPlugin())
    .launch({ headless: true });

  const page = await browser.newPage({ hasTouch: true });

  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}
