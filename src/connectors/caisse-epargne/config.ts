/**
 * Configuration for Caisse d'Épargne connector
 *
 * This file contains all URLs, selectors, and settings specific to
 * Caisse d'Épargne Île-de-France. Other regional Caisse d'Épargne
 * banks may require different URLs (change the region in LOGIN_URL).
 */

// =============================================================================
// URLs
// =============================================================================

/** Login page URL - change "ile-de-france" for other regions */
export const LOGIN_URL = "https://www.caisse-epargne.fr/ile-de-france/";

/** URL pattern to detect successful login (dashboard) */
export const DASHBOARD_URL_PATTERN = "**/espace-client/compte";

// =============================================================================
// API ENDPOINTS
// =============================================================================

const API_BASE = "https://www.rs-ext-bad-ce.caisse-epargne.fr/bapi";

export const API = {
  /** Lists accounts with their last download info */
  lastDownloadHistory: `${API_BASE}/transactionDownload/v1/lastDownloadHistoryViews?userId=currentUser`,

  /** Lists all download requests (history) */
  historyRequests: `${API_BASE}/transactionDownload/v1/historyRequests`,

  /** Creates a new download request (POST) */
  createHistoryRequest: `${API_BASE}/transactionDownload/v1/historyRequests`,

  /** Prepares a download and returns the download URL (POST) */
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
  // Login flow
  loginButton: "text=Espace personnel",
  identifierInput: "#input-identifier",
  identifierSubmit: "#p-identifier-btn-validate",
  keyboardButton: "as-keyboard-button",
  keyboardButtonElement: "as-keyboard-button > button",
  passwordSubmit: "#p-password-btn-submit",

  // Transaction download
  downloadButton: "text=Télécharger les opérations",
  historyTab: "#history",
};
