/**
 * Authentication for Swile — pure API, no browser.
 *
 * Handles:
 *   - password grant against directory.swile.co
 *   - email MFA on first login ("missing_authentication_code"):
 *     prompts for the 6-digit code Swile sends by email
 *     (or reads it from the SWILE_OTP env var for automation)
 *   - device trust: the "verified-identity" / "verified-credentials"
 *     response headers are persisted to disk and replayed on later
 *     logins so MFA is only ever needed once per machine
 *   - access-token caching: tokens are reused until expiry, so most
 *     runs perform zero login requests
 */

import fs from "fs";
import path from "path";
import { OAUTH_TOKEN_URL, CLIENT_ID, BASE_HEADERS } from "./config";
import { promptForCode } from "../../lib/two-factor";

const AUTH_STATE_DIR = path.join("data", ".browser");
const AUTH_STATE_FILE = path.join(AUTH_STATE_DIR, "swile-auth.json");

interface AuthState {
  /** Device-trust headers returned after a verified login */
  verifiedIdentity?: string;
  verifiedCredentials?: string;
  /** Cached bearer token */
  accessToken?: string;
  /** Unix ms timestamp when accessToken expires */
  accessTokenExpiresAt?: number;
  refreshToken?: string;
}

function loadState(): AuthState {
  try {
    return JSON.parse(fs.readFileSync(AUTH_STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: AuthState): void {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** Headers to send with every authenticated API call */
export function apiHeaders(token: string): Record<string, string> {
  return { ...BASE_HEADERS, Authorization: `Bearer ${token}` };
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

async function postToken(
  body: Record<string, string>,
  state: AuthState
): Promise<Response> {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (state.verifiedIdentity) headers["verified-identity"] = state.verifiedIdentity;
  if (state.verifiedCredentials)
    headers["verified-credentials"] = state.verifiedCredentials;

  return fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function storeToken(state: AuthState, res: Response, json: TokenResponse): void {
  // Device-trust headers come back on verified logins — persist them
  const identity = res.headers.get("verified-identity");
  const credentials = res.headers.get("verified-credentials");
  if (identity) state.verifiedIdentity = identity;
  if (credentials) state.verifiedCredentials = credentials;

  state.accessToken = json.access_token;
  // Default to 25 min if expires_in is absent; refresh 5 min early
  const lifetimeMs = (json.expires_in ?? 1800) * 1000;
  state.accessTokenExpiresAt = Date.now() + lifetimeMs - 5 * 60 * 1000;
  if (json.refresh_token) state.refreshToken = json.refresh_token;
  saveState(state);
}

/**
 * Returns a valid access token, performing whatever auth is necessary:
 * cached token → refresh token → password grant (+ email MFA once).
 */
export async function login(username: string, password: string): Promise<string> {
  if (!username || !password) {
    throw new Error("SWILE_USERNAME and SWILE_PASSWORD must be set in .env");
  }

  const state = loadState();

  // 1. Cached token still valid?
  if (
    state.accessToken &&
    state.accessTokenExpiresAt &&
    Date.now() < state.accessTokenExpiresAt
  ) {
    return state.accessToken;
  }

  // 2. Refresh token?
  if (state.refreshToken) {
    const res = await postToken(
      {
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: state.refreshToken,
      },
      state
    );
    if (res.ok) {
      const json = (await res.json()) as TokenResponse;
      storeToken(state, res, json);
      console.log("🔑 Token refreshed");
      return json.access_token;
    }
    // Refresh failed — fall through to password grant
    delete state.refreshToken;
  }

  // 3. Password grant
  const credentials: Record<string, string> = {
    client_id: CLIENT_ID,
    grant_type: "password",
    username,
    password,
  };

  let res = await postToken(credentials, state);

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errorCode = String(err.error ?? "");

    if (errorCode === "missing_authentication_code") {
      // Swile just emailed a 6-digit code to the account address
      const recipient = String(err.recipient ?? "your email");
      console.log(`📧 Swile sent a verification code to ${recipient}`);
      const code = process.env.SWILE_OTP
        ? process.env.SWILE_OTP.trim()
        : await promptForCode("🔐 Enter the code from the Swile email: ");

      res = await postToken({ ...credentials, authentication_code: code }, state);
      if (!res.ok) {
        const retryErr = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          `Swile MFA failed (${res.status}): ${JSON.stringify(retryErr)}`
        );
      }
    } else if (errorCode === "invalid_grant") {
      throw new Error("Swile login failed: wrong username or password");
    } else {
      throw new Error(
        `Swile login failed (${res.status}): ${JSON.stringify(err)}`
      );
    }
  }

  const json = (await res.json()) as TokenResponse;
  storeToken(state, res, json);
  console.log("🔑 Logged in to Swile");
  return json.access_token;
}
