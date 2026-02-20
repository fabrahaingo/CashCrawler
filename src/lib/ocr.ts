/**
 * OCR utilities for reading virtual keyboard buttons
 *
 * Uses Tesseract.js for fast, lightweight OCR. Accepts image buffers
 * directly to avoid disk I/O overhead.
 *
 * The virtual keyboard always shows digits 0-9 exactly once each.
 * When OCR misreads a digit (producing duplicates), we use confidence
 * scores and process-of-elimination to correct the mapping.
 */

import Tesseract from "tesseract.js";

let worker: Tesseract.Worker | null = null;

/**
 * Gets or creates the Tesseract worker (singleton)
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker("eng", Tesseract.OEM.DEFAULT, {
      legacyCore: true,
      legacyLang: true,
    });
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
    });
  }
  return worker;
}

/** Result of recognizing a single digit, including confidence */
interface DigitResult {
  digit: number;
  confidence: number;
}

/**
 * Recognizes a single digit from an image buffer
 */
export async function recognizeDigit(imageBuffer: Buffer): Promise<number> {
  const w = await getWorker();
  const { data } = await w.recognize(imageBuffer);
  const digit = parseInt(data.text.trim(), 10);

  if (isNaN(digit) || digit < 0 || digit > 9) {
    throw new Error(`OCR did not return a valid digit: "${data.text}"`);
  }

  return digit;
}

/**
 * Recognizes digits from multiple image buffers, returning both
 * the digit and the confidence score for each.
 */
async function recognizeAllWithConfidence(
  buffers: Buffer[]
): Promise<DigitResult[]> {
  const w = await getWorker();
  const results = await Promise.all(
    buffers.map(async (buf) => {
      const { data } = await w.recognize(buf);
      const digit = parseInt(data.text.trim(), 10);
      return {
        digit: isNaN(digit) ? -1 : digit,
        confidence: data.confidence ?? 0,
      };
    })
  );
  return results;
}

/**
 * Recognizes digits from multiple image buffers.
 *
 * Since the virtual keyboard always contains exactly digits 0-9 (each once),
 * we can detect and fix OCR errors using process of elimination:
 *
 * 1. Run OCR on all 10 buttons
 * 2. If the result is a valid permutation of {0..9}, return it
 * 3. Otherwise, find duplicated digits and missing digits
 * 4. Among the buttons that produced a duplicate, the one with the lowest
 *    confidence is most likely the misread — reassign it to the missing digit
 *
 * This handles the common case where OCR misreads one digit as another
 * (e.g., "7" read as "1"), which produces one duplicate and one missing digit.
 */
export async function recognizeAllDigits(buffers: Buffer[]): Promise<number[]> {
  const results = await recognizeAllWithConfidence(buffers);
  const digits = results.map((r) => r.digit);

  // Check if already valid
  if (isValidPermutation(digits)) {
    return digits;
  }

  // Find which digits are missing and which are duplicated
  const digitCount = new Map<number, number>();
  for (const d of digits) {
    digitCount.set(d, (digitCount.get(d) || 0) + 1);
  }

  const missing: number[] = [];
  for (let i = 0; i <= 9; i++) {
    if (!digitCount.has(i)) {
      missing.push(i);
    }
  }

  const duplicated: number[] = [];
  for (const [d, count] of digitCount) {
    if (count > 1) {
      duplicated.push(d);
    }
  }

  // If we have exactly as many missing as duplicated, we can fix it
  if (missing.length > 0 && missing.length === duplicated.length) {
    console.log(
      `  [ocr] Fixing misread: duplicated=[${duplicated}], missing=[${missing}]`
    );

    // For each duplicated digit, find the button with the lowest confidence
    // and reassign it to a missing digit
    for (const dupDigit of duplicated) {
      // Find all button indices that produced this duplicate
      const indices = digits
        .map((d, i) => (d === dupDigit ? i : -1))
        .filter((i) => i >= 0);

      // Sort by confidence ascending — lowest confidence is most likely wrong
      indices.sort((a, b) => results[a].confidence - results[b].confidence);

      // Reassign the lowest-confidence one to the next missing digit
      const missingDigit = missing.shift();
      if (missingDigit !== undefined) {
        const fixIndex = indices[0];
        console.log(
          `  [ocr] Button ${fixIndex}: ${dupDigit} → ${missingDigit} ` +
            `(confidence: ${results[fixIndex].confidence.toFixed(1)}%)`
        );
        digits[fixIndex] = missingDigit;
      }
    }
  }

  if (!isValidPermutation(digits)) {
    console.log(
      `  [ocr] Warning: could not fully fix OCR result: [${digits.join(", ")}]`
    );
  }

  return digits;
}

/**
 * Checks if an array is a valid permutation of {0, 1, ..., 9}
 */
function isValidPermutation(digits: number[]): boolean {
  if (digits.length !== 10) return false;
  const seen = new Set(digits);
  if (seen.size !== 10) return false;
  for (let i = 0; i <= 9; i++) {
    if (!seen.has(i)) return false;
  }
  return true;
}

/**
 * Terminates the OCR worker to free resources
 */
export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
