/**
 * Transaction extraction for UAF Life Patrimoine
 *
 * Fetches transaction history (mouvements) for each contract via the
 * REST API at api.uaflife-patrimoine.fr/life-api.
 *
 * Contract ID format: "{codePeripherique}#{numeroContrat}" (e.g., "AXE#123456789")
 * The # must be URL-encoded as %23 in API paths (handled by config.ts).
 *
 * Output: semicolon-separated CSV with DD/MM/YYYY dates, preserving
 * all fields from the API response.
 */

import { Page } from "playwright";
import { ENDPOINTS } from "./config";
import { apiGet } from "./api";
import { createSpinner } from "../../lib/spinner";

// =============================================================================
// TYPES
// =============================================================================

interface ContractInfo {
  /** Contract key: "{codePeripherique}#{numeroContrat}" */
  id: string;
  /** Display name (e.g., "NetLife 2 - Spirica") */
  name: string;
}

/** A single movement/transaction — raw fields from the API */
interface RawMovement {
  [key: string]: any;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extracts contract list from the synthese endpoint.
 * Uses the known response shape: { contrats: [{ codePeripherique, numeroContrat, ... }] }
 */
async function getContracts(
  page: Page,
  token: string
): Promise<ContractInfo[]> {
  const syntheseData = await apiGet(page, ENDPOINTS.clientSynthesis, token);
  const contrats = syntheseData?.contrats;

  if (!Array.isArray(contrats)) return [];

  return contrats
    .filter((c: any) => c.codePeripherique && c.numeroContrat)
    .map((c: any) => ({
      id: `${c.codePeripherique}#${c.numeroContrat}`,
      name: [c.libelleProduit, c.libelleFournisseur].filter(Boolean).join(" - "),
    }));
}

/**
 * Extracts an array from an API response, handling wrapper objects.
 */
function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of [
      "data",
      "items",
      "contrats",
      "mouvements",
      "movements",
      "operations",
      "liste",
    ]) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/**
 * Converts an ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) to DD/MM/YYYY.
 * Returns the original string if it doesn't match ISO format.
 */
function toFrenchDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;

  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  return dateStr;
}

/**
 * Sanitizes a value for CSV output.
 * Wraps in quotes if it contains the delimiter (;) or quotes.
 */
function csvSanitize(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value).replace(/\r?\n/g, " ").trim();
  if (str.includes(";") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Flattens a nested object into a single-level object with dot-notation keys.
 * e.g., { a: { b: 1 } } → { "a.b": 1 }
 */
function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Converts all date-looking fields in a movement to DD/MM/YYYY format.
 */
function normalizeDates(movement: RawMovement): RawMovement {
  const result: RawMovement = {};
  for (const [key, value] of Object.entries(movement)) {
    if (
      typeof value === "string" &&
      /date/i.test(key) &&
      /^\d{4}-\d{2}-\d{2}/.test(value)
    ) {
      result[key] = toFrenchDate(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Builds CSV content from an array of raw movements.
 * All fields from the API are included as columns.
 * Nested objects are flattened with dot-notation keys.
 */
function movementsToCsv(movements: RawMovement[]): string {
  if (movements.length === 0) return "";

  // Flatten all movements first
  const flattened = movements.map((m) => flattenObject(m));

  // Collect all unique keys across all movements to build the header
  const allKeys = new Set<string>();
  for (const m of flattened) {
    for (const key of Object.keys(m)) {
      allKeys.add(key);
    }
  }

  const headers = Array.from(allKeys);
  const headerLine = headers.map(csvSanitize).join(";");

  const lines = [headerLine];
  for (const m of flattened) {
    const normalized = normalizeDates(m);
    const values = headers.map((h) => csvSanitize(normalized[h]));
    lines.push(values.join(";"));
  }

  return lines.join("\n");
}

/**
 * Finds the earliest date in the movements for the CSV filename.
 */
function findEarliestDate(movements: RawMovement[]): string | null {
  let earliest: Date | null = null;

  for (const m of movements) {
    const flat = flattenObject(m);
    for (const [key, value] of Object.entries(flat)) {
      if (!/date/i.test(key) || typeof value !== "string") continue;

      let parsed: Date | null = null;

      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        parsed = new Date(value);
      }
      const frMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (frMatch) {
        parsed = new Date(
          Number(frMatch[3]),
          Number(frMatch[2]) - 1,
          Number(frMatch[1])
        );
      }

      if (parsed && !isNaN(parsed.getTime())) {
        if (!earliest || parsed < earliest) {
          earliest = parsed;
        }
      }
    }
  }

  if (!earliest) return null;

  const y = earliest.getFullYear();
  const mo = String(earliest.getMonth() + 1).padStart(2, "0");
  const d = String(earliest.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Extracts transactions for all UAF Life contracts.
 *
 * For each contract:
 *   1. Calls GET /contrats/{id}/mouvements?limit=500
 *   2. Falls back to /contrats/{id}/export/mouvements if no data
 *   3. Saves all API fields as CSV columns
 *
 * @param page Playwright page instance (must be on the app)
 * @param token Bearer token from login
 * @returns Array of { accountName, csvContent, startDate } for saving
 */
export async function extractTransactions(
  page: Page,
  token: string
): Promise<Array<{ accountName: string; csvContent: string; startDate: string }>> {
  const spinner = createSpinner("Fetching contract list...");
  spinner.start();

  const contracts = await getContracts(page, token);

  if (contracts.length === 0) {
    spinner.stop("⚠️ No contracts found");
    return [];
  }

  spinner.stop(`📋 Found ${contracts.length} contract(s)`);

  const results: Array<{
    accountName: string;
    csvContent: string;
    startDate: string;
  }> = [];

  for (const contract of contracts) {
    console.log(`\n📋 Processing contract: ${contract.name} (${contract.id})`);

    let movements: RawMovement[] = [];

    // =========================================================================
    // Attempt 1: /contrats/{id}/mouvements with high limit
    // =========================================================================

    try {
      const path = `${ENDPOINTS.contractMovements(contract.id)}?limit=500`;
      const mouvementsData = await apiGet(page, path, token);

      // Log raw response shape for debugging
      console.log(
        `  [debug] mouvements response type: ${typeof mouvementsData}, ` +
          `keys: ${mouvementsData && typeof mouvementsData === "object" ? Object.keys(mouvementsData).join(", ") : "N/A"}`
      );

      movements = extractArray(mouvementsData);

      // If the response is a single object that looks like a movement
      if (
        movements.length === 0 &&
        mouvementsData &&
        typeof mouvementsData === "object" &&
        !Array.isArray(mouvementsData)
      ) {
        const keys = Object.keys(mouvementsData);
        if (keys.some((k) => /date|montant|operation/i.test(k))) {
          movements = [mouvementsData];
        }
      }

      if (movements.length > 0) {
        console.log(
          `  [debug] first movement keys: ${Object.keys(movements[0]).join(", ")}`
        );
      }

      console.log(`  Found ${movements.length} movement(s) from /mouvements`);
    } catch (err) {
      console.log(
        `  ⚠️ /mouvements failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // =========================================================================
    // Attempt 2: /contrats/{id}/export/mouvements (fallback)
    // =========================================================================

    if (movements.length === 0) {
      try {
        console.log("  Trying /export/mouvements fallback...");
        const exportData = await apiGet(
          page,
          ENDPOINTS.contractExportMovements(contract.id),
          token
        );

        if (typeof exportData === "string") {
          console.log(
            `  Found export data (${exportData.split("\n").length} lines)`
          );
          const startDate = new Date().toISOString().split("T")[0];
          results.push({
            accountName: contract.name,
            csvContent: exportData,
            startDate,
          });
          continue;
        }

        movements = extractArray(exportData);
        console.log(
          `  Found ${movements.length} movement(s) from /export/mouvements`
        );
      } catch (err) {
        console.log(
          `  ⚠️ /export/mouvements also failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // =========================================================================
    // Convert to CSV
    // =========================================================================

    if (movements.length === 0) {
      console.log("  ⚠️ No movements found for this contract");
      continue;
    }

    const csvContent = movementsToCsv(movements);
    const startDate =
      findEarliestDate(movements) ?? new Date().toISOString().split("T")[0];

    console.log(
      `  ✓ ${movements.length} transactions (start date: ${startDate})`
    );

    results.push({
      accountName: contract.name,
      csvContent,
      startDate,
    });
  }

  return results;
}
