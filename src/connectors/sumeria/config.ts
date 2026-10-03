/**
 * Configuration for Sumeria connector
 *
 * Sumeria (formerly Lydia) uses a Next.js web app at app.sumeria.eu
 * backed by a REST API at api.lydia-app.com.
 *
 * Authentication is phone-based OTP:
 *   1. POST /oauth/otp/_init with phone number → returns authorization_id
 *   2. User enters 6-digit code from the Sumeria mobile app
 *   3. POST /oauth/otp/_verify with code → returns JWT access_token (30min)
 *
 * All API calls use Bearer token auth + x-app-source header.
 */

// =============================================================================
// URLs
// =============================================================================

export const APP_URL = "https://app.sumeria.eu";
export const LOGIN_URL = `${APP_URL}/login`;
export const API_BASE = "https://api.lydia-app.com";

// =============================================================================
// AUTH
// =============================================================================

export const OAUTH_CLIENT_ID =
  "7_48rxft3ctyckgckw88k00sk48ggkoks8w40g040o48cgocgkgk";

// =============================================================================
// API ENDPOINTS
// =============================================================================

export const ENDPOINTS = {
  otpInit: `${API_BASE}/oauth/otp/_init`,
  otpVerify: `${API_BASE}/oauth/otp/_verify`,
  accounts: `${API_BASE}/accounts`,
  historySearch: `${API_BASE}/history/_search`,
  bankStatementCsv: `${API_BASE}/bankstatementcsv`,
};

// =============================================================================
// HISTORY SEARCH
// =============================================================================

/** Page size for history/_search pagination */
export const HISTORY_PAGE_SIZE = 100;
