/**
 * Transaction download for Caisse d'Épargne
 *
 * Downloads transaction history as CSV files for all accounts.
 * The bank provides up to 792 days (~2 years) of history.
 */

import { Page } from "playwright";
import { LOGIN_URL, SELECTORS, API, SETTINGS } from "./config";
import { BANK_IDS } from "../../lib/types";
import {
  getTodayDate,
  getDateDaysAgo,
  saveTransactionsCSV,
  hasTransactionsForToday,
} from "../../lib/storage";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

interface AccountInfo {
  pfmContractId: string;
  accountName: string;
  historyRequestId?: string;
}

interface RequestContext {
  authHeader: string;
  userAgent: string;
  origin: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extracts pfmContractId from various API response formats
 */
function extractPfmId(obj: any): string | undefined {
  const id = obj?.pfmContractId?.pfmContractId
    ?? obj?.pfmContractId?.id
    ?? obj?.pfmContractId
    ?? obj?.contractPfmId;

  return id != null ? String(id) : undefined;
}

/**
 * Extracts account info from the main API response
 */
function extractAccounts(apiData: any): AccountInfo[] {
  return (apiData?.items || [])
    .filter((item: any) => item.identification?.contractPfmId)
    .map((item: any) => ({
      pfmContractId: String(item.identification.contractPfmId),
      accountName: item.identity?.contractLabel || `Account ${item.identification.contractPfmId}`,
    }));
}

/**
 * Creates standard headers for API requests
 */
function makeHeaders(ctx: RequestContext, contentType?: string): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    ...(contentType && { "Content-Type": contentType }),
    Origin: ctx.origin,
    Referer: LOGIN_URL,
    "User-Agent": ctx.userAgent,
    ...(ctx.authHeader && { Authorization: ctx.authHeader }),
  };
}

// =============================================================================
// MAIN DOWNLOAD FUNCTION
// =============================================================================

/**
 * Downloads transactions for all accounts
 *
 * @returns true if transactions were downloaded, false if skipped
 */
export async function downloadTransactions(
  page: Page,
  apiData: any
): Promise<boolean> {
  const today = getTodayDate();
  const startDate = getDateDaysAgo(SETTINGS.maxDaysBack);

  // Extract account info
  const accounts = extractAccounts(apiData);
  const accountNames = accounts.map((a) => a.accountName);

  // Guard: Check if already downloaded today
  if (hasTransactionsForToday(BANK_IDS.CAISSE_EPARGNE, accountNames)) {
    console.log("✅ Transactions already downloaded today. Nothing to do!");
    return false;
  }

  console.log(`📅 Downloading transactions from ${startDate} to ${today}`);

  // Click download button and capture auth header
  await page.waitForSelector(SELECTORS.downloadButton, { timeout: 20000 });

  let authHeader = "";
  const captureAuth = (req: any) => {
    const auth = req.headers()["authorization"];
    if (auth) authHeader = auth;
  };
  page.on("request", captureAuth);

  const lastDownloadPromise = page.waitForResponse(
    (res) => res.url().includes("lastDownloadHistoryViews") && res.status() === 200,
    { timeout: 30000 }
  );

  await page.click(SELECTORS.downloadButton);
  const lastDownloadResponse = await lastDownloadPromise;

  // Get auth from response if not captured
  if (!authHeader) {
    authHeader = lastDownloadResponse.request().headers()["authorization"] || "";
  }
  page.off("request", captureAuth);

  const ctx: RequestContext = {
    authHeader,
    userAgent: await page.evaluate(() => navigator.userAgent),
    origin: new URL(LOGIN_URL).origin,
  };

  // Get existing history requests
  const historyPromise = page.waitForResponse(
    (res) => res.url().includes("/transactionDownload/v1/historyRequests") && res.status() === 200,
    { timeout: 30000 }
  );
  await page.click(SELECTORS.historyTab);
  const historyData = await (await historyPromise).json();

  // Build map of existing history requests by pfmContractId
  const historyMap = new Map<string, any>();
  for (const item of historyData.operationIdResponseItem || []) {
    const pfmId = extractPfmId(item.identity);
    if (pfmId && !historyMap.has(pfmId)) {
      historyMap.set(pfmId, item);
    }
  }

  // Check if all accounts have correct date range
  const allReady = accounts.every((acc) => {
    const hist = historyMap.get(acc.pfmContractId);
    return hist?.identity?.startDate === startDate && hist?.identity?.endDate === today;
  });

  // Prepare accounts with history request IDs
  let accountsToDownload: AccountInfo[];

  if (allReady) {
    // Use existing prepared files
    accountsToDownload = accounts.map((acc) => ({
      ...acc,
      historyRequestId: historyMap.get(acc.pfmContractId)?.identification?.historyRequestId?.id,
    }));
  } else {
    // Create new download requests
    accountsToDownload = await createDownloadRequests(page, accounts, startDate, today, ctx);
  }

  // Download CSV files in parallel
  const downloadSpinner = createSpinner("Downloading transaction files...");
  downloadSpinner.start();

  const results = await Promise.all(
    accountsToDownload
      .filter((acc) => acc.historyRequestId)
      .map((acc) => downloadAccountCSV(page, acc, startDate, ctx))
  );

  const downloadedCount = results.filter(Boolean).length;
  downloadSpinner.stop(`💾 Downloaded ${downloadedCount} account(s)`);

  return true;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates download requests for accounts
 */
async function createDownloadRequests(
  page: Page,
  accounts: AccountInfo[],
  startDate: string,
  endDate: string,
  ctx: RequestContext
): Promise<AccountInfo[]> {
  const spinner = createSpinner("Preparing download requests...");
  spinner.start();

  let successCount = 0;

  for (const account of accounts) {
    const payload = {
      pfmContractId: { id: account.pfmContractId },
      idType: { code: "0" },
      contractRelationContext: { code: "1" },
      includeAttachment: false,
      dateFormatType: { code: "0" },
      separateType: { code: "3" },
      decimalSeparateType: { code: "0" },
      startDate,
      endDate,
      fileType: { code: "0" },
    };

    try {
      const response = await page.context().request.post(API.createHistoryRequest, {
        data: payload,
        headers: makeHeaders(ctx, "application/json"),
        failOnStatusCode: false,
      });

      if (response.ok()) successCount++;
    } catch {
      // Continue on error
    }

    await page.waitForTimeout(SETTINGS.requestDelay);
  }

  if (successCount === 0) {
    spinner.stop();
    throw new Error("Failed to create any download requests.");
  }

  spinner.stop(`📝 Prepared ${successCount} account(s)`);

  // Wait for files to be ready
  const waitSpinner = createSpinner("Waiting for bank to prepare files...");
  waitSpinner.start();
  await page.waitForTimeout(SETTINGS.downloadWaitTime);
  waitSpinner.stop("📦 Files ready");

  // Get updated history requests
  const response = await page.context().request.get(API.historyRequests, {
    headers: makeHeaders(ctx),
    failOnStatusCode: false,
  });
  const data = await response.json();

  // Build updated map
  const updatedMap = new Map<string, string>();
  for (const item of data.operationIdResponseItem || []) {
    const pfmId = extractPfmId(item.identity);
    const histId = item.identification?.historyRequestId?.id;
    if (pfmId && histId) {
      updatedMap.set(pfmId, histId);
    }
  }

  return accounts.map((acc) => ({
    ...acc,
    historyRequestId: updatedMap.get(acc.pfmContractId),
  }));
}

/**
 * Downloads the CSV file for a single account
 */
async function downloadAccountCSV(
  page: Page,
  account: AccountInfo,
  startDate: string,
  ctx: RequestContext
): Promise<boolean> {
  try {
    // Prepare download
    const prepareResponse = await page.context().request.post(
      API.prepareDownload(account.historyRequestId!),
      {
        data: {
          characteristics: {
            historyRequestId: { id: account.historyRequestId },
          },
        },
        headers: makeHeaders(ctx, "application/json"),
        failOnStatusCode: false,
      }
    );

    const prepareData = await prepareResponse.json().catch(() => null);
    const downloadUrl = prepareData?.prepareDownload?.characteristics?.downloadUrl;

    if (!downloadUrl) return false;

    // Fetch CSV
    const fileResponse = await page.context().request.get(downloadUrl, {
      headers: {
        ...makeHeaders(ctx),
        Accept: "text/csv, application/octet-stream, */*",
      },
      timeout: 60000,
    });

    if (!fileResponse.ok()) return false;

    const csvContent = await fileResponse.text();
    saveTransactionsCSV(BANK_IDS.CAISSE_EPARGNE, account.accountName, startDate, csvContent);

    return true;
  } catch {
    return false;
  }
}
