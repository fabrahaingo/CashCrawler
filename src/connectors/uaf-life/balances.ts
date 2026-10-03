/**
 * Balance extraction for UAF Life Patrimoine
 *
 * Uses the REST API at api.uaflife-patrimoine.fr/life-api.
 * The /espaceclient/fiche/synthese endpoint returns client info
 * with a `contrats` array. Each contract has `donneesFinancieres.encours`.
 *
 * API response shape:
 * {
 *   contrats: [{
 *     numeroContrat: "123456789",
 *     codePeripherique: "AXE",
 *     libelleProduit: "NetLife 2",
 *     libelleFournisseur: "Spirica",
 *     donneesFinancieres: {
 *       encours: 5000.00,
 *       dateReference: "2026-01-01",
 *       valeurRachat: 5000.00,
 *       montantVerse: 5000,
 *       montantRachete: 0,
 *       plusMoinsValue: 0.00,
 *       ...
 *     },
 *     ...
 *   }]
 * }
 */

import { Page } from "playwright";
import { AccountBalance } from "../../lib/types";
import { ENDPOINTS } from "./config";
import { apiGet } from "./api";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Extracts account balances from the UAF Life API
 *
 * @param page Playwright page instance (must be on the app, session cookie set)
 * @returns Array of account balances
 */
export async function extractBalances(
  page: Page,
): Promise<AccountBalance[]> {
  const spinner = createSpinner("Fetching account data from API...");
  spinner.start();

  try {
    const syntheseData = await apiGet(page, ENDPOINTS.clientSynthesis);
    const contrats = syntheseData?.contrats;

    if (!Array.isArray(contrats) || contrats.length === 0) {
      spinner.stop("⚠️ No contracts found in synthese response");
      return [];
    }

    const balances: AccountBalance[] = [];

    for (const contrat of contrats) {
      const name = [
        contrat.libelleProduit,
        contrat.libelleFournisseur,
        contrat.numeroContrat,
      ]
        .filter(Boolean)
        .join(" - ");

      const encours = contrat.donneesFinancieres?.encours;

      if (typeof encours === "number" && !isNaN(encours)) {
        balances.push({ account: name || "Unknown", balance: encours });
      } else {
        console.log(`  ⚠️ No encours for contract: ${name}`);
      }
    }

    spinner.stop("📊 Account data retrieved");
    return balances;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
