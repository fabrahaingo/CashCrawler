/**
 * Configuration for Bourse Direct connector
 *
 * Bourse Direct uses a React SPA for authentication (auth.js),
 * rendered into a #auth-app container. The login form, 2FA modal,
 * and all interactive elements are dynamically loaded.
 *
 * Account data pages (inventory, historique, relevés) embed legacy PHP
 * pages inside an iframe (class="iframe-legacy-resized"). All account
 * data (dropdowns, tables) lives inside these iframes.
 *
 * 2FA is handled via a modal (#2FA-modal) with a 6-digit code input
 * (SMS or TOTP) and optional device trust radio buttons.
 */

// =============================================================================
// URLs
// =============================================================================

/** Login page (contains the React auth SPA) */
export const LOGIN_URL = "https://www.boursedirect.fr/fr/login";

/** Inventory page (legacy page with account balances in an iframe) */
export const INVENTORY_URL = "https://www.boursedirect.fr/fr/page/inventaire";

/** Account history page (legacy page with recent transactions in an iframe) */
export const HISTORIQUE_URL =
  "https://www.boursedirect.fr/fr/page/historique-de-compte";

/**
 * Monthly account statement URL template.
 * Parameters:
 *   nc — account number (e.g., "1")
 *   dt — last day of the statement period in YYYYMMDD format
 */
export function getReleveCompteUrl(nc: string, dt: string): string {
  return `https://www.boursedirect.fr/priv/new/releveCompte.php?nc=${nc}&dt=${dt}&type=RE`;
}

// =============================================================================
// DOM SELECTORS
// =============================================================================

export const SELECTORS = {
  // Login form (React SPA, lazy-loaded LoginForm chunk)
  usernameInput: '[data-testid="input-username"]',
  passwordInput: '[data-testid="input-password"]',
  submitButton: '[data-testid="button-submit"]',

  // 2FA modal (React portal, appended to document.body)
  // The modal wrapper is #2FA-modal, containing #auth-modal-backdrop + #auth-modal
  // We detect the modal via the backdrop's .opened class (set after CSS transition)
  twoFactorModal: "#auth-modal-backdrop.opened",
  // OTP code inputs use react-code-input with class "code-input"
  otpFirstInput: ".code-input input:first-child",
  trustDeviceYes: "input[id='trusted']",
  twoFactorSubmit: "button.primary",

  // Cookie consent (Didomi)
  cookieAccept: "#didomi-notice-agree-button",

  // Shared — legacy iframe present on inventory, historique, relevés pages
  /** The iframe containing legacy PHP content */
  legacyIframe: 'iframe[class*="iframe-legacy"]',
  /** Account selector dropdown (inside iframe), id="nc" name="nc" */
  accountSelect: "select#nc",

  // Inventory page — inside legacy iframe
  /** The inventory data table (inside iframe) */
  inventoryTable: "table.table-bd",

  // Historique de compte page — inside legacy iframe
  /** The transaction history table (inside iframe) */
  historiqueTable: "table.datas.retour",
};
