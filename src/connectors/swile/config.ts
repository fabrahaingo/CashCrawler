/**
 * Configuration for Swile connector
 *
 * Swile (formerly Lunchr) is a meal-voucher card. The web app at
 * app.swile.co talks to a set of REST APIs:
 *
 *   - directory.swile.co    → OAuth (password grant + email MFA)
 *   - customer-api.swile.co → user profile & wallet balances
 *   - banking-api.swile.co  → payments history
 *
 * Authentication flow (no browser needed):
 *   1. POST /oauth/token {client_id, grant_type: "password", username, password}
 *   2. First login from a device → 400 "missing_authentication_code";
 *      Swile emails a 6-digit code
 *   3. Retry the same POST with "authentication_code" added → 200 with
 *      access_token, plus "verified-identity" / "verified-credentials"
 *      response HEADERS (device trust)
 *   4. Persist those two headers and send them on later logins → no more MFA
 *
 * The client_id and X-API-Key below are the public web-app values
 * (also used by the woob open-source Swile module).
 */

export const OAUTH_TOKEN_URL = "https://directory.swile.co/oauth/token";
// Wallet balances: employee BFF (bearer-authed, returns every wallet).
// Transactions: banking-api payments_history.
// (customer-api.swile.co, used by older woob-style integrations, is dead.)
export const BFF_API = "https://employee-bff-api.swile.co";
export const BANKING_API = "https://banking-api.swile.co";

export const CLIENT_ID =
  "533bf5c8dbd05ef18fd01e2bbbab3d7f69e3511dd08402862b5de63b9a238923";

/** Public web-app headers — required by all Swile APIs */
export const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "X-API-Key": "50558e8b836b7a8e089c35b7b58a1d3959ca56d6",
  "X-Lunchr-Platform": "web",
  "X-Lunchr-App-Version": "0.1.0",
};

export const ENDPOINTS = {
  getWallets: `${BFF_API}/api/wallets/get-wallets`,
  paymentsHistory: `${BANKING_API}/api/v0/payments_history`,
};

/** Page size for payments_history pagination */
export const HISTORY_PAGE_SIZE = 50;

/** Safety cap on pagination loops */
export const MAX_PAGES = 400;
