/**
 * Configuration for UAF Life Patrimoine connector
 *
 * UAF Life is a life insurance / investment platform.
 * Unlike Caisse d'Épargne, it uses a standard login form
 * (no virtual keyboard or OCR needed).
 */

// =============================================================================
// URLs
// =============================================================================

export const HOME_URL = "https://www.uaflife-patrimoine.fr/accueil";
export const LOGIN_URL =
  "https://securite.uaflife-patrimoine.fr/life-securite/login.xhtml";
export const DASHBOARD_URL = "https://www.uaflife-patrimoine.fr/group/client";

// =============================================================================
// DOM SELECTORS
// =============================================================================

export const SELECTORS = {
  // Login flow
  connectButton: "#connect",
  loginForm: "#saisieInfosConnexions",
  usernameInput: 'input[name="name"]',
  passwordInput: 'input[name="password"]',
  submitButton: "#btnConnexion",

  // Dashboard scraping
  accountIframe: 'iframe[src*="portefeuilleAssure.xhtml"]',
  accountTable: "tbody",
  accountNameCell: '[data-title="Produit"]',
  balanceCell: '[data-title="Encours"]',
};
