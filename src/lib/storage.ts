/**
 * Storage utilities for managing bank data files
 *
 * This module handles all file I/O operations for:
 * - Transaction history (CSV files)
 * - Balance snapshots (JSON files)
 *
 * Directory structure:
 * ```
 * data/
 *   balances/
 *     [bank-id]/
 *       YYYY-MM-DD.json          # Daily balance snapshots
 *   transactions/
 *     [bank-id]/
 *       [account-name]/
 *         history-from-YYYYMMDD.csv  # Transaction history
 * ```
 */

import fs from "fs";
import path from "path";
import { BankId } from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Base directory for all data files (relative to project root) */
export const DATA_DIR = "data";

// =============================================================================
// DATE UTILITIES
// =============================================================================

/** Returns today's date in YYYY-MM-DD format */
export function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** Returns a date N days ago in YYYY-MM-DD format */
export function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

// =============================================================================
// FILE SYSTEM UTILITIES
// =============================================================================

/** Ensures a directory exists, creating it recursively if needed */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Sanitizes a string for use as a folder/file name
 *
 * Transformations:
 * - Removes accents (e.g., "Livret A" stays, "Épargne" -> "Epargne")
 * - Removes special characters
 * - Replaces spaces with underscores
 * - Converts to lowercase
 *
 * @example sanitizeName("Compte Courant") // "compte_courant"
 * @example sanitizeName("Livret A") // "livret_a"
 */
export function sanitizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-zA-Z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .toLowerCase()
    .trim();
}

// =============================================================================
// PATH BUILDERS
// =============================================================================

/** Gets the transactions directory for a bank */
export function getTransactionsDir(bankId: BankId): string {
  return path.join(DATA_DIR, "transactions", bankId);
}

/** Gets the account folder path for transactions */
export function getAccountDir(bankId: BankId, accountName: string): string {
  return path.join(getTransactionsDir(bankId), sanitizeName(accountName));
}

/** Gets the balances directory for a bank */
export function getBalancesDir(bankId: BankId): string {
  return path.join(DATA_DIR, "balances", bankId);
}

/**
 * Generates the transactions filename
 * @param startDate Start date in YYYY-MM-DD format
 * @returns Filename in format: history-from-YYYYMMDD.csv
 */
export function getTransactionsFilename(startDate: string): string {
  const compactDate = startDate.replace(/-/g, "");
  return `history-from-${compactDate}.csv`;
}

/** Generates the balances filename (YYYY-MM-DD.json) */
export function getBalancesFilename(date: string = getTodayDate()): string {
  return `${date}.json`;
}

// =============================================================================
// BALANCE STORAGE
// =============================================================================

export interface StoredBalance {
  account: string;
  balance: number;
}

export interface BalanceSnapshot {
  date: string;
  timestamp: string;
  balances: StoredBalance[];
}

/**
 * Saves balances to a JSON file
 * @returns The path to the saved file
 */
export function saveBalances(bankId: BankId, balances: StoredBalance[]): string {
  const dir = getBalancesDir(bankId);
  ensureDir(dir);

  const snapshot: BalanceSnapshot = {
    date: getTodayDate(),
    timestamp: new Date().toISOString(),
    balances,
  };

  const filename = getBalancesFilename();
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  return filePath;
}

/**
 * Loads the most recent balance snapshot for a bank
 * @returns The latest snapshot, or null if none exists
 */
export function loadLatestBalances(bankId: BankId): BalanceSnapshot | null {
  const dir = getBalancesDir(bankId);

  if (!fs.existsSync(dir)) {
    return null;
  }

  // Get all JSON files sorted by name (date) descending
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const latestFile = path.join(dir, files[0]);
  const content = fs.readFileSync(latestFile, "utf-8");
  return JSON.parse(content) as BalanceSnapshot;
}

/** Returns true if balances have already been retrieved today */
export function hasBalancesForToday(bankId: BankId): boolean {
  const latest = loadLatestBalances(bankId);
  return latest?.date === getTodayDate();
}

// =============================================================================
// TRANSACTIONS STORAGE
// =============================================================================

export interface TransactionFileInfo {
  accountName: string;
  bankId: BankId;
  startDate: string;
  filePath: string;
  lastModified: Date;
}

/**
 * Parses a transactions filename to extract the start date
 * @param filename Filename in format: history-from-YYYYMMDD.csv
 * @returns Object with startDate in YYYY-MM-DD format, or null if invalid
 */
export function parseTransactionsFilename(
  filename: string
): { startDate: string } | null {
  const match = filename.match(/^history-from-(\d{8})\.csv$/);
  if (!match) return null;

  const compact = match[1];
  const startDate = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;

  return { startDate };
}

/** Gets info about the latest transactions file for an account */
export function getLatestTransactionsFile(
  bankId: BankId,
  accountName: string
): TransactionFileInfo | null {
  const accountDir = getAccountDir(bankId, accountName);

  if (!fs.existsSync(accountDir)) {
    return null;
  }

  const files = fs.readdirSync(accountDir).filter((f) => f.endsWith(".csv"));

  if (files.length === 0) {
    return null;
  }

  // Find the most recently modified file
  let latestFile: string | null = null;
  let latestMtime: Date | null = null;

  for (const file of files) {
    const filePath = path.join(accountDir, file);
    const stat = fs.statSync(filePath);
    if (!latestMtime || stat.mtime > latestMtime) {
      latestMtime = stat.mtime;
      latestFile = file;
    }
  }

  if (!latestFile || !latestMtime) {
    return null;
  }

  const parsed = parseTransactionsFilename(latestFile);
  if (!parsed) {
    return null;
  }

  return {
    accountName,
    bankId,
    startDate: parsed.startDate,
    filePath: path.join(accountDir, latestFile),
    lastModified: latestMtime,
  };
}

/**
 * Checks if transactions have been downloaded today for ALL accounts
 *
 * This is used as a guard to skip unnecessary downloads. Returns true
 * only if every account has a transaction file modified today.
 */
export function hasTransactionsForToday(
  bankId: BankId,
  accountNames: string[]
): boolean {
  const today = getTodayDate();

  for (const accountName of accountNames) {
    const fileInfo = getLatestTransactionsFile(bankId, accountName);
    if (!fileInfo) {
      return false;
    }

    const fileDate = fileInfo.lastModified.toISOString().split("T")[0];
    if (fileDate !== today) {
      return false;
    }
  }

  return true;
}

/**
 * Saves a transactions CSV file for an account
 *
 * If a file already exists for this account, the new data is merged
 * with the existing data (duplicates removed). This allows accumulating
 * transactions beyond the bank's history limit (e.g., 792 days).
 *
 * The filename uses the earliest start date (either from existing file
 * or the new download), ensuring data is always merged into the same file.
 *
 * @param bankId Bank identifier
 * @param accountName Account name (will be sanitized for folder name)
 * @param startDate Start date in YYYY-MM-DD format (from current download)
 * @param csvContent CSV content to save
 * @returns Path to the saved file
 */
export function saveTransactionsCSV(
  bankId: BankId,
  accountName: string,
  startDate: string,
  csvContent: string
): string {
  const accountDir = getAccountDir(bankId, accountName);
  ensureDir(accountDir);

  const newLines = csvContent.split("\n").filter((l) => l.trim());
  const newDataCount = newLines.length - 1; // exclude header
  const newHeader = newLines[0]?.trim() ?? "";

  // Check if we have an existing file
  const existingFile = getLatestTransactionsFile(bankId, accountName);

  if (existingFile) {
    const existingContent = fs.readFileSync(existingFile.filePath, "utf-8");
    const existingLines = existingContent.split("\n").filter((l) => l.trim());
    const existingDataCount = existingLines.length - 1;
    const existingHeader = existingLines[0]?.trim() ?? "";

    // SAFETY: Never lose rows. If new data has fewer rows and same format,
    // we merge (which only adds). If format changed, archive + warn.
    const formatChanged = existingHeader !== newHeader;

    if (formatChanged) {
      // Archive the old file — never delete it
      const archivePath = existingFile.filePath.replace(".csv", ".legacy.csv");
      if (!fs.existsSync(archivePath)) {
        fs.copyFileSync(existingFile.filePath, archivePath);
        console.log(
          `⚠️  CSV format changed for ${accountName}. Old file archived to: ${archivePath}`
        );
      }
      // Write new format
      const effectiveStartDate = existingFile.startDate < startDate
        ? existingFile.startDate
        : startDate;
      const filename = getTransactionsFilename(effectiveStartDate);
      const filePath = path.join(accountDir, filename);
      fs.writeFileSync(filePath, csvContent, "utf-8");
      return filePath;
    }

    // Same format — always merge (never replace)
    const mergedContent = mergeCSV(existingContent, csvContent);
    const mergedDataCount = mergedContent.split("\n").filter((l) => l.trim()).length - 1;

    // SAFETY: merged file must have at least as many rows as the existing file
    if (mergedDataCount < existingDataCount) {
      throw new Error(
        `Data loss prevented for ${bankId}/${accountName}: ` +
        `merge would reduce rows from ${existingDataCount} to ${mergedDataCount}. ` +
        `This should never happen — investigate before retrying.`
      );
    }

    fs.writeFileSync(existingFile.filePath, mergedContent, "utf-8");
    return existingFile.filePath;
  }

  // No existing file — write new
  const effectiveStartDate = startDate;
  const filename = getTransactionsFilename(effectiveStartDate);
  const filePath = path.join(accountDir, filename);
  fs.writeFileSync(filePath, csvContent, "utf-8");
  return filePath;
}

// =============================================================================
// DATA INTEGRITY VALIDATION
// =============================================================================

/**
 * Validates that transaction files haven't lost data compared to a previous run.
 *
 * Call this after any download to verify row counts only grew (or stayed same).
 * Throws an error if any account has fewer rows than before, which would mean
 * irreplaceable historical data was lost.
 *
 * @param bankId Bank identifier
 * @param expectedMinRows Map of account name → minimum expected row count
 */
export function validateNoDataLoss(
  bankId: BankId,
  expectedMinRows: Map<string, number>
): void {
  for (const [accountName, minRows] of expectedMinRows) {
    const fileInfo = getLatestTransactionsFile(bankId, accountName);
    if (!fileInfo) {
      throw new Error(
        `Data loss detected for ${bankId}/${accountName}: ` +
        `file is missing (expected at least ${minRows} rows)`
      );
    }

    const content = fs.readFileSync(fileInfo.filePath, "utf-8");
    const dataRows = content.split("\n").filter((l) => l.trim()).length - 1;

    if (dataRows < minRows) {
      throw new Error(
        `Data loss detected for ${bankId}/${accountName}: ` +
        `file has ${dataRows} rows but expected at least ${minRows}. ` +
        `Check ${fileInfo.filePath}`
      );
    }
  }
}

/**
 * Merges two CSV contents, removing duplicate rows
 * Keeps the header from the existing file and sorts by date (newest first)
 *
 * Assumes the first column is a date in DD/MM/YYYY format (Caisse d'Épargne format)
 */
function mergeCSV(existing: string, newContent: string): string {
  const existingLines = existing.split("\n").filter((l) => l.trim());
  const newLines = newContent.split("\n").filter((l) => l.trim());

  if (existingLines.length === 0) return newContent;
  if (newLines.length === 0) return existing;

  const header = existingLines[0];
  const allData = new Set<string>();

  // Add all data rows (skip headers)
  for (const line of existingLines.slice(1)) {
    allData.add(line);
  }
  for (const line of newLines.slice(1)) {
    allData.add(line);
  }

  // Sort by date (first column, DD/MM/YYYY format) - newest first
  const sortedData = Array.from(allData).sort((a, b) => {
    const dateA = parseFrenchDate(a.split(";")[0]);
    const dateB = parseFrenchDate(b.split(";")[0]);
    return dateB.getTime() - dateA.getTime(); // Descending (newest first)
  });

  return [header, ...sortedData].join("\n");
}

/**
 * Parses a French date string (DD/MM/YYYY) into a Date object
 */
function parseFrenchDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}


