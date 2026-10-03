/**
 * Configuration for Caisse d'Épargne connector
 *
 * This file contains all URLs, selectors, and settings specific to
 * Caisse d'Épargne Île-de-France. Other regional Caisse d'Épargne
 * banks may require different URLs (change the region in LOGIN_URL).
 *
 * Updated for ICG Auth (new authentication portal, Angular SPA).
 */

// =============================================================================
// URLs
// =============================================================================

/** Direct login URL via ICG Auth portal */
export const LOGIN_URL =
  "https://www.icgauth.caisse-epargne.fr/se-connecter/sso?service=dei";

/** URL pattern to detect successful login (dashboard) */
export const DASHBOARD_URL_PATTERN = "**/espace-client/**";

/** Origin for API requests (used in Referer/Origin headers) */
export const ORIGIN = "https://www.caisse-epargne.fr";

// =============================================================================
// API ENDPOINTS
// =============================================================================

const API_BASE = "https://www.rs-ext-bad-ce.caisse-epargne.fr/bapi";
const PFM_BASE = "https://www.rs-ext-bad-ce.caisse-epargne.fr/pfm/user/v1.1";

export const API = {
  /** Account synthesis (contains PFM account IDs in _links) */
  augmentedSynthesisViews: `${API_BASE}/contract/v2/augmentedSynthesisViews?pfmCharacteristicsIndicator=true&productFamilyPFM=1,2,3,4,6,7,17,18,20,19`,

  /** PFM transactions for an account (returns all history in one call) */
  pfmTransactions: (accountId: string) =>
    `${PFM_BASE}/transactions?accountIds=${accountId}`,

  /**
   * Pending card operations ("Opérations carte en cours"): same PFM endpoint,
   * filtered on status WD. The plain call above only returns booked (AC)
   * operations. Query copied from the CE web app (found with ce:discover).
   */
  pfmPendingTransactions: (accountId: string) =>
    `${PFM_BASE}/transactions?businessType=UserProfile&take=200&orderBy=ByOriginalDate&includeDisabledAccounts=true&useAndSearchForParsedData=true&parsedData=${encodeURIComponent(
      JSON.stringify([
        { key: "status", value: "WD" },
        { key: "transactionGranularityCode", value: "IN" },
        { key: "transactionGranularityCode", value: "ST" },
      ])
    )}&accountIds=${accountId}`,

  /** Lists accounts with their last download info (legacy CSV download) */
  lastDownloadHistory: `${API_BASE}/transactionDownload/v1/lastDownloadHistoryViews?userId=currentUser`,

  /** Lists all download requests (history) (legacy CSV download) */
  historyRequests: `${API_BASE}/transactionDownload/v1/historyRequests`,

  /** Creates a new download request (POST) (legacy CSV download) */
  createHistoryRequest: `${API_BASE}/transactionDownload/v1/historyRequests`,

  /** Prepares a download and returns the download URL (POST) (legacy CSV download) */
  prepareDownload: (id: string) =>
    `${API_BASE}/transactionDownload/v1/historyRequests/${id}/prepareDownload`,
};

// =============================================================================
// SETTINGS
// =============================================================================

export const SETTINGS = {
  /**
   * Maximum days of transaction history to download
   * This is a bank-imposed limit (approximately 2 years and 2 months)
   */
  maxDaysBack: 792,

  /** Time to wait for bank to prepare download files (ms) */
  downloadWaitTime: 5000,

  /** Delay between API requests to avoid rate limiting (ms) */
  requestDelay: 1000,
};

// =============================================================================
// DOM SELECTORS
// =============================================================================

export const SELECTORS = {
  // Login flow (ICG Auth Angular SPA)
  identifierInput: "neo-input-text[name='identifier'] input, .input-identifier input",
  identifierSubmit: "#p-identifier-btn-validate",
  keyboardButton: "as-keyboard-button",
  keyboardButtonElement: "as-keyboard-button button.keyboard-button",
  passwordSubmit: "#p-password-btn-submit",

  // Transaction download
  downloadButton: "text=Télécharger les opérations",
  historyTab: "#history",
};

// =============================================================================
// IMAGE EXTRACTION
// =============================================================================

/**
 * Regex to extract base64 image data from keyboard button styles.
 *
 * The new ICG Auth uses: background: center no-repeat url(data:image/png;base64,...)
 * The old system used: background-image: url("data:image/png;base64,...")
 * This regex handles both formats.
 */
export const KEYBOARD_IMAGE_REGEX =
  /url\(?["']?(data:image\/png;base64,[^"')]+)["']?\)?/;
