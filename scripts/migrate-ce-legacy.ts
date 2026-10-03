/**
 * Migrates old CE CSV transactions into the new PFM format.
 *
 * The old format (13 columns):
 *   Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;
 *   Informations complementaires;Type operation;Categorie;Sous categorie;
 *   Debit;Credit;Date operation;Date de valeur;Pointage operation
 *
 * The new PFM format (18 columns):
 *   date;amount;currency;text;category_id;counterparty;counterparty_iban;
 *   counterparty_bic;counterparty_bank;type_code;subtype_code;status;
 *   label2;label3;original_text;accounting_date;merchant_id;transaction_id
 *
 * Fields mapped from old → new:
 *   Date de comptabilisation → date (already DD/MM/YYYY)
 *   Debit/Credit → amount (parsed, negative for debit)
 *   Libelle simplifie → text
 *   Libelle operation → original_text
 *   Informations complementaires → label2
 *   Type operation → type_code
 *   Categorie → label3 (bank's own category)
 *   Sous categorie → subtype_code (bank's own subcategory)
 *   Date operation → accounting_date (reformatted)
 *
 * PFM-specific fields (counterparty IBAN/BIC, category_id, etc.) are left
 * empty for legacy rows since that data wasn't available.
 */

import fs from "fs";
import path from "path";

const CE_DIR = path.join("data", "transactions", "ce");
const LEGACY_DIR = path.join("data", "transactions", "ce-legacy-csv");

const NEW_HEADER =
  "date;amount;currency;text;category_id;counterparty;counterparty_iban;counterparty_bic;counterparty_bank;type_code;subtype_code;status;label2;label3;original_text;accounting_date;merchant_id;transaction_id";

/**
 * Parses a French number string: "-150,00" → -150.00, "+45,40" → 45.40
 */
function parseFrenchAmount(debit: string, credit: string): string {
  if (debit && debit.trim()) {
    const val = parseFloat(debit.replace(/\s/g, "").replace(",", "."));
    return isNaN(val) ? "0.00" : val.toFixed(2);
  }
  if (credit && credit.trim()) {
    const val = parseFloat(
      credit.replace(/\s/g, "").replace(",", ".").replace("+", "")
    );
    return isNaN(val) ? "0.00" : val.toFixed(2);
  }
  return "0.00";
}

/**
 * Converts a DD/MM/YYYY date to YYYY-MM-DD for the accounting_date field
 */
function reformatDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * Escapes semicolons in a field value
 */
function esc(s: string): string {
  return (s ?? "").replace(/;/g, ",").replace(/\n/g, " ");
}

/**
 * Converts an old-format CSV line to the new PFM format
 */
function convertOldRow(line: string): string | null {
  const cols = line.split(";");
  if (cols.length < 13) return null;

  const [
    dateCompta,
    libSimple,
    libOperation,
    reference,
    infosComp,
    typeOp,
    categorie,
    sousCategorie,
    debit,
    credit,
    dateOp,
    _dateValeur,
    _pointage,
  ] = cols;

  // Skip header row
  if (dateCompta === "Date de comptabilisation") return null;

  // Validate date
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateCompta)) return null;

  const amount = parseFrenchAmount(debit, credit);
  const accountingDate = reformatDate(dateOp || dateCompta);

  // Parse infos complementaires — often contains two parts separated by "-"
  const infosParts = (infosComp ?? "").split("-");
  const label2 = esc(infosParts[0]?.trim() ?? "");
  const label3 = esc(categorie?.trim() ?? "");

  return [
    dateCompta,                       // date
    amount,                           // amount
    "EUR",                            // currency
    esc(libSimple),                   // text
    "",                               // category_id (not available in old format)
    "",                               // counterparty (not available)
    "",                               // counterparty_iban
    "",                               // counterparty_bic
    "",                               // counterparty_bank
    esc(typeOp),                      // type_code
    esc(sousCategorie),               // subtype_code
    "",                               // status
    label2,                           // label2
    label3,                           // label3
    esc(libOperation),                // original_text
    accountingDate,                   // accounting_date
    "",                               // merchant_id
    esc(reference),                   // transaction_id (use reference as ID)
  ].join(";");
}

/**
 * Parses a DD/MM/YYYY date for comparison
 */
function parseDateStr(dateStr: string): Date {
  const [d, m, y] = dateStr.split("/").map(Number);
  return new Date(y, m - 1, d);
}

function main(): void {
  if (!fs.existsSync(LEGACY_DIR)) {
    console.log("No legacy CE files found at", LEGACY_DIR);
    return;
  }

  const accounts = fs.readdirSync(LEGACY_DIR).filter((d) => {
    return fs.statSync(path.join(LEGACY_DIR, d)).isDirectory();
  });

  console.log(`Found ${accounts.length} legacy accounts to migrate\n`);

  for (const account of accounts) {
    const legacyDir = path.join(LEGACY_DIR, account);
    const activeDir = path.join(CE_DIR, account);

    const legacyFiles = fs
      .readdirSync(legacyDir)
      .filter((f) => f.endsWith(".csv"));
    if (legacyFiles.length === 0) continue;

    const legacyFile = path.join(legacyDir, legacyFiles[0]);
    const legacyContent = fs.readFileSync(legacyFile, "utf-8");
    const legacyLines = legacyContent.split("\n").filter((l) => l.trim());

    // Convert all legacy rows to new format
    const convertedRows: string[] = [];
    for (const line of legacyLines.slice(1)) {
      const converted = convertOldRow(line);
      if (converted) convertedRows.push(converted);
    }

    console.log(`${account}: ${convertedRows.length} legacy rows converted`);

    // Find the active file
    if (!fs.existsSync(activeDir)) {
      // No active file — write all converted rows
      fs.mkdirSync(activeDir, { recursive: true });
      const content = [NEW_HEADER, ...convertedRows].join("\n");
      const startDate = legacyFiles[0].match(/history-from-(\d{8})/)?.[1];
      const formatted = startDate
        ? `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`
        : "unknown";
      const outFile = path.join(activeDir, legacyFiles[0]);
      fs.writeFileSync(outFile, content, "utf-8");
      console.log(`  → Created ${outFile} (${convertedRows.length} rows)`);
      continue;
    }

    const activeFiles = fs
      .readdirSync(activeDir)
      .filter((f) => f.endsWith(".csv") && !f.includes(".legacy."));
    if (activeFiles.length === 0) continue;

    const activeFile = path.join(activeDir, activeFiles[0]);
    const activeContent = fs.readFileSync(activeFile, "utf-8");
    const activeLines = activeContent.split("\n").filter((l) => l.trim());

    // Find the oldest date in the active file
    const activeDataLines = activeLines.slice(1);
    let oldestActiveDate: Date | null = null;
    for (const line of activeDataLines) {
      const dateStr = line.split(";")[0];
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const d = parseDateStr(dateStr);
        if (!oldestActiveDate || d < oldestActiveDate) {
          oldestActiveDate = d;
        }
      }
    }

    // Filter legacy rows to only those OLDER than the active file's oldest
    const olderRows = convertedRows.filter((row) => {
      const dateStr = row.split(";")[0];
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return false;
      const d = parseDateStr(dateStr);
      return oldestActiveDate && d < oldestActiveDate;
    });

    if (olderRows.length === 0) {
      console.log("  → No older transactions to add");
      continue;
    }

    // Merge: active data + older legacy rows, sorted newest first
    const allRows = [...activeDataLines, ...olderRows];
    const uniqueRows = Array.from(new Set(allRows));
    uniqueRows.sort((a, b) => {
      const da = parseDateStr(a.split(";")[0]);
      const db = parseDateStr(b.split(";")[0]);
      return db.getTime() - da.getTime();
    });

    // Update filename to reflect the earlier start date
    const legacyStartDate = legacyFiles[0].match(/history-from-(\d{8})/)?.[1];
    const newFilename = legacyStartDate
      ? `history-from-${legacyStartDate}.csv`
      : activeFiles[0];
    const newFilePath = path.join(activeDir, newFilename);

    // If filename changed, remove old file
    if (newFilePath !== activeFile && fs.existsSync(activeFile)) {
      fs.unlinkSync(activeFile);
    }

    const mergedContent = [NEW_HEADER, ...uniqueRows].join("\n");
    fs.writeFileSync(newFilePath, mergedContent, "utf-8");
    console.log(
      `  → Merged ${olderRows.length} older rows → ${newFilePath} (${uniqueRows.length} total)`
    );
  }

  console.log("\n✅ Migration complete!");
}

main();
