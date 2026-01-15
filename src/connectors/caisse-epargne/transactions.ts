/**
 * Transaction download for Caisse d'Épargne
 *
 * Downloads transaction history as CSV files for all accounts.
 * The bank provides up to 792 days (~2 years) of history.
 *
 * Flow:
 * 1. Click "Télécharger les opérations" button
 * 2. Check existing download history via API
 * 3. Create new download requests if needed
 * 4. Wait for files to be prepared
 * 5. Download CSV files for each account
 */

import { Page } from "playwright";
import path from "path";
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

interface AccountDownloadInfo {
  pfmContractId?: string;
  accountName?: string;
  downloadDate?: string;
  startDate?: string;
  endDate?: string;
  historyRequestId?: string;
}

interface AccountInfo {
  pfmContractId: string;
  accountName: string;
}

// =============================================================================
// AUTH HELPERS
// =============================================================================

/**
 * Builds a proper Authorization header from a raw token
 */
function buildAuthorizationHeader(rawToken: string | null): string {
  if (!rawToken) return "";
  if (/^Bearer\s+/i.test(rawToken)) return rawToken;
  return `Bearer ${rawToken}`;
}

/**
 * Extracts auth token from browser storage (localStorage/sessionStorage)
 */
function extractTokenFromStorage(
  entries: Array<[string, string]>
): { token: string; sourceKey: string } | null {
  for (const [key, value] of entries) {
    if (!value) continue;

    // Look for Bearer token pattern
    const bearerMatch = value.match(/Bearer\s+[A-Za-z0-9._-]+/i);
    if (bearerMatch) {
      return { token: bearerMatch[0], sourceKey: key };
    }

    // Try parsing as JSON for token fields
    if (value.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        const tokenCandidate =
          parsed?.access_token ||
          parsed?.token ||
          parsed?.id_token ||
          parsed?.authorization;
        if (typeof tokenCandidate === "string" && tokenCandidate.length > 10) {
          return { token: tokenCandidate, sourceKey: key };
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Check key name for token-like entries
    if (/token|auth/i.test(key) && value.length > 10) {
      return { token: value, sourceKey: key };
    }
  }

  return null;
}

/**
 * Resolves the auth header from request or browser storage
 */
async function resolveAuthHeader(
  page: Page,
  fallbackAuthHeader: string
): Promise<{ header: string; source: string }> {
  if (fallbackAuthHeader) {
    return { header: fallbackAuthHeader, source: "request" };
  }

  const storageEntries = await page.evaluate(() => {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value !== null) pairs.push([key, value]);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      const value = sessionStorage.getItem(key);
      if (value !== null) pairs.push([key, value]);
    }
    return pairs;
  });

  const found = extractTokenFromStorage(storageEntries);
  if (!found) {
    return { header: "", source: "none" };
  }

  return {
    header: buildAuthorizationHeader(found.token),
    source: `storage:${found.sourceKey}`,
  };
}

// =============================================================================
// DATA EXTRACTION HELPERS
// =============================================================================

/**
 * Extracts pfmContractId from various API response formats
 */
function extractPfmContractId(identity: any): string | undefined {
  const direct = identity?.pfmContractId;
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct);
  }
  if (direct?.id) return String(direct.id);

  const contractPfmId = identity?.contractPfmId;
  if (typeof contractPfmId === "string" || typeof contractPfmId === "number") {
    return String(contractPfmId);
  }
  if (contractPfmId?.id) return String(contractPfmId.id);

  return undefined;
}

/**
 * Extracts pfmContractId from history request response (nested structure)
 */
function extractHistoryRequestPfmContractId(identity: any): string | undefined {
  const nested = identity?.pfmContractId?.pfmContractId;
  if (typeof nested === "string" || typeof nested === "number") {
    return String(nested);
  }

  const direct = identity?.pfmContractId;
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct);
  }
  if (direct?.id) return String(direct.id);

  return undefined;
}

/**
 * Extracts account info from the main API response
 */
function extractAccountsFromApiData(apiData: any): AccountInfo[] {
  const items = apiData?.items || [];
  return items
    .filter((item: any) => item.identification?.contractPfmId)
    .map((item: any) => ({
      pfmContractId: String(item.identification.contractPfmId),
      accountName:
        item.identity?.contractLabel ||
        `Account ${item.identification.contractPfmId}`,
    }));
}

// =============================================================================
// MAIN DOWNLOAD FUNCTION
// =============================================================================

/**
 * Downloads transactions for all accounts
 *
 * @param page Playwright page instance (must be logged in and on dashboard)
 * @param apiData The API response data from augmentedSynthesisViews
 * @returns true if transactions were downloaded, false if skipped (already up to date)
 */
export async function downloadTransactions(
  page: Page,
  apiData: any
): Promise<boolean> {
  const today = getTodayDate();
  const startDate = getDateDaysAgo(SETTINGS.maxDaysBack);

  // Extract account info from API data
  const accountsFromApi = extractAccountsFromApiData(apiData);
  const pfmToName = new Map(
    accountsFromApi.map((a) => [a.pfmContractId, a.accountName])
  );
  const accountNames = accountsFromApi.map((a) => a.accountName);

  // Guard: Check if transactions have already been downloaded today
  if (hasTransactionsForToday(BANK_IDS.CAISSE_EPARGNE, accountNames)) {
    console.log("✅ Transactions already downloaded today. Nothing to do!");
    return false;
  }

  console.log(`📅 Downloading transactions from ${startDate} to ${today}`);

  // Step 1: Click download button and capture auth header
  await page.waitForSelector(SELECTORS.downloadButton, { timeout: 20000 });

  let capturedAuthHeader = "";
  const authCaptureListener = (request: any) => {
    const auth = request.headers()["authorization"];
    if (auth) capturedAuthHeader = auth;
  };
  page.on("request", authCaptureListener);

  // Set up listener for lastDownloadHistory API call
  const lastDownloadPromise = page.waitForResponse(
    (response) =>
      response.url().includes("lastDownloadHistoryViews") &&
      response.status() === 200,
    { timeout: 30000 }
  );

  await page.click(SELECTORS.downloadButton);

  // Step 2: Get last download history
  const lastDownloadResponse = await lastDownloadPromise;
  const lastDownloadData = await lastDownloadResponse.json();
  const authHeaderFromRequest =
    lastDownloadResponse.request().headers()["authorization"] || "";

  const { header: authHeader } = await resolveAuthHeader(
    page,
    authHeaderFromRequest || capturedAuthHeader
  );
  const userAgent = await page.evaluate(() => navigator.userAgent);

  page.off("request", authCaptureListener);

  const operationItems = lastDownloadData.operationIdResponseItem || [];

  // Step 3: Get existing history requests
  const historyRequestsPromise = page.waitForResponse(
    (response) =>
      response.url().includes("/transactionDownload/v1/historyRequests") &&
      response.status() === 200,
    { timeout: 30000 }
  );
  await page.click(SELECTORS.historyTab);
  const historyRequestsResponse = await historyRequestsPromise;
  const historyRequestsData = await historyRequestsResponse.json();
  const historyRequestItems =
    historyRequestsData.operationIdResponseItem || [];

  // Step 4: Extract account info for download
  const accountsInfo: AccountDownloadInfo[] = operationItems.map(
    (item: any) => {
      const pfmId = extractPfmContractId(item.identity);
      return {
        pfmContractId: pfmId,
        accountName: pfmId ? pfmToName.get(pfmId) : undefined,
        downloadDate: item.identity?.downloadDate,
        startDate: item.identity?.startDate,
        endDate: item.identity?.endDate,
        historyRequestId: item.identification?.historyRequestId?.id,
      };
    }
  );

  // Get target account IDs
  const targetPfmContractIds = new Set(
    accountsInfo.map((a) => a.pfmContractId).filter(Boolean)
  );

  // Step 5: Check if we have existing history requests with correct date range
  const historyByAccount = new Map<string, any>();
  for (const item of historyRequestItems) {
    const pfmId = extractHistoryRequestPfmContractId(item.identity);
    if (
      pfmId &&
      targetPfmContractIds.has(pfmId) &&
      !historyByAccount.has(pfmId)
    ) {
      historyByAccount.set(pfmId, item);
    }
  }

  // Check if all accounts have correct date range
  const allHaveCorrectDateRange = Array.from(targetPfmContractIds).every(
    (pfmId) => {
      const historyItem = historyByAccount.get(pfmId!);
      return (
        historyItem &&
        historyItem.identity?.startDate === startDate &&
        historyItem.identity?.endDate === today
      );
    }
  );

  let accountsWithIds: AccountDownloadInfo[];

  if (allHaveCorrectDateRange) {
    // Use existing prepared files from bank
    accountsWithIds = Array.from(targetPfmContractIds).map((pfmId) => {
      const item = historyByAccount.get(pfmId!);
      const extractedPfmId = extractHistoryRequestPfmContractId(item.identity);
      return {
        pfmContractId: extractedPfmId,
        accountName: extractedPfmId ? pfmToName.get(extractedPfmId) : undefined,
        downloadDate: item.identity?.downloadDate,
        startDate: item.identity?.startDate,
        endDate: item.identity?.endDate,
        historyRequestId: item.identification?.historyRequestId?.id,
      };
    });
  } else {
    accountsWithIds = await createDownloadRequests(
      page,
      accountsInfo,
      startDate,
      today,
      authHeader,
      userAgent,
      pfmToName,
      targetPfmContractIds
    );
  }

  // Step 6: Download CSV files
  const downloadSpinner = createSpinner("Downloading transaction files...");
  downloadSpinner.start();

  let downloadedCount = 0;
  for (const accountInfo of accountsWithIds) {
    if (!accountInfo.historyRequestId || !accountInfo.pfmContractId) {
      continue;
    }

    const success = await downloadAccountCSV(
      page,
      accountInfo,
      startDate,
      authHeader,
      userAgent
    );
    if (success) downloadedCount++;
  }

  downloadSpinner.stop(`💾 Downloaded ${downloadedCount} account(s)`);
  return true;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates download requests for accounts that need them
 */
async function createDownloadRequests(
  page: Page,
  accountsInfo: AccountDownloadInfo[],
  startDate: string,
  endDate: string,
  authHeader: string,
  userAgent: string,
  pfmToName: Map<string, string>,
  targetPfmContractIds: Set<string | undefined>
): Promise<AccountDownloadInfo[]> {
  const spinner = createSpinner("Preparing download requests...");
  spinner.start();

  let successCount = 0;
  for (const accountInfo of accountsInfo) {
    const pfmContractId = accountInfo.pfmContractId;
    if (!pfmContractId) continue;

    const payload = {
      pfmContractId: { id: pfmContractId },
      idType: { code: "0" },
      contractRelationContext: { code: "1" },
      includeAttachment: false,
      dateFormatType: { code: "0" },
      separateType: { code: "3" },
      decimalSeparateType: { code: "0" },
      startDate: startDate,
      endDate: endDate,
      fileType: { code: "0" },
    };

    try {
      const response = await page
        .context()
        .request.post(API.createHistoryRequest, {
          data: payload,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: new URL(LOGIN_URL).origin,
            Referer: LOGIN_URL,
            "User-Agent": userAgent,
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          failOnStatusCode: false,
        });

      if (response.ok()) {
        successCount++;
      }
    } catch (error) {
      // Silently continue on error
    }

    await page.waitForTimeout(SETTINGS.requestDelay);
  }

  if (successCount === 0) {
    spinner.stop();
    throw new Error("Failed to create any download requests. Aborting.");
  }

  spinner.stop(`📝 Prepared ${successCount} account(s)`);

  // Wait for files to be ready
  const waitSpinner = createSpinner("Waiting for bank to prepare files...");
  waitSpinner.start();
  await page.waitForTimeout(SETTINGS.downloadWaitTime);
  waitSpinner.stop("📦 Files ready");

  // Get updated list
  const updatedResponse = await page.context().request.get(API.historyRequests, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: new URL(LOGIN_URL).origin,
      Referer: LOGIN_URL,
      "User-Agent": userAgent,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    failOnStatusCode: false,
  });
  const updatedData = await updatedResponse.json();
  const updatedItems = updatedData.operationIdResponseItem || [];

  // Build map of updated history requests
  const updatedHistoryByAccount = new Map<string, any>();
  for (const item of updatedItems) {
    const pfmId = extractHistoryRequestPfmContractId(item.identity);
    if (
      pfmId &&
      targetPfmContractIds.has(pfmId) &&
      !updatedHistoryByAccount.has(pfmId)
    ) {
      updatedHistoryByAccount.set(pfmId, item);
    }
  }

  return Array.from(targetPfmContractIds)
    .filter((pfmId) => updatedHistoryByAccount.has(pfmId!))
    .map((pfmId) => {
      const item = updatedHistoryByAccount.get(pfmId!);
      const extractedPfmId = extractHistoryRequestPfmContractId(item.identity);
      return {
        pfmContractId: extractedPfmId,
        accountName: extractedPfmId ? pfmToName.get(extractedPfmId) : undefined,
        downloadDate: item.identity?.downloadDate,
        startDate: item.identity?.startDate,
        endDate: item.identity?.endDate,
        historyRequestId: item.identification?.historyRequestId?.id,
      };
    });
}

/**
 * Downloads the CSV file for a single account
 * @returns true if download succeeded, false otherwise
 */
async function downloadAccountCSV(
  page: Page,
  accountInfo: AccountDownloadInfo,
  startDate: string,
  authHeader: string,
  userAgent: string
): Promise<boolean> {
  try {
    // Prepare download
    const prepareUrl = API.prepareDownload(accountInfo.historyRequestId!);
    const prepareResponse = await page.context().request.post(prepareUrl, {
      data: {
        characteristics: {
          historyRequestId: { id: accountInfo.historyRequestId },
        },
      },
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: new URL(LOGIN_URL).origin,
        Referer: LOGIN_URL,
        "User-Agent": userAgent,
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      failOnStatusCode: false,
    });

    const prepareContentType = prepareResponse.headers()["content-type"] || "";
    const prepareBody = await prepareResponse.text();
    const prepareData =
      prepareContentType.includes("application/json") && prepareBody
        ? JSON.parse(prepareBody)
        : null;

    if (!prepareData) {
      return false;
    }

    const downloadUrl =
      prepareData.prepareDownload?.characteristics?.downloadUrl;

    if (!downloadUrl) {
      return false;
    }

    // Fetch the CSV file
    const fileResponse = await page.context().request.get(downloadUrl, {
      headers: {
        Accept: "text/csv, application/octet-stream, */*",
        Origin: new URL(LOGIN_URL).origin,
        Referer: LOGIN_URL,
        "User-Agent": userAgent,
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      timeout: 60000,
    });

    if (!fileResponse.ok()) {
      return false;
    }

    const csvContent = await fileResponse.text();

    // Save the CSV file
    const accountName =
      accountInfo.accountName || `Account_${accountInfo.pfmContractId}`;
    saveTransactionsCSV(BANK_IDS.CAISSE_EPARGNE, accountName, startDate, csvContent);

    return true;
  } catch (error) {
    return false;
  }
}
