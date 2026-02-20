/**
 * Configuration for UAF Life Patrimoine connector
 *
 * UAF Life is a life insurance / investment platform.
 * The new app (app.uaflife-patrimoine.fr) uses a REST API
 * with Bearer token authentication stored in sessionStorage.
 */

// =============================================================================
// URLs
// =============================================================================

/** Main SPA entry point — redirects to identity provider for login */
export const APP_URL = "https://app.uaflife-patrimoine.fr/app";

/** Base URL for all REST API calls (separate subdomain from the SPA) */
export const API_BASE = "https://api.uaflife-patrimoine.fr/life-api";

// =============================================================================
// API ENDPOINTS (relative to API_BASE)
// =============================================================================

export const ENDPOINTS = {
  /** GET — check if the current session is authenticated */
  isConnected: "/securite/est_connecte",

  /** GET — current user profile */
  profile: "/securite/profil",

  /** GET — client synthesis (contracts overview with balances) */
  clientSynthesis: "/espaceclient/fiche/synthese",

  /** GET — list all contracts */
  contracts: "/contrats",

  /** GET — encours (current value) for a specific contract */
  contractEncours: (id: string) => `/contrats/${encodeURIComponent(id)}/encours`,

  /** GET — movements (transactions) for a specific contract */
  contractMovements: (id: string) => `/contrats/${encodeURIComponent(id)}/mouvements`,

  /** GET — export movements as file for a specific contract */
  contractExportMovements: (id: string) => `/contrats/${encodeURIComponent(id)}/export/mouvements`,

  /** GET — allocation breakdown for a specific contract */
  contractRepartition: (id: string) => `/contrats/${encodeURIComponent(id)}/repartition`,
};

// =============================================================================
// DOM SELECTORS (login form on identity provider)
// =============================================================================

export const SELECTORS = {
  connectButton: "#connect",
  loginForm: "#saisieInfosConnexions",
  usernameInput: 'input[name="name"]',
  passwordInput: 'input[name="password"]',
  submitButton: "#btnConnexion",
};
