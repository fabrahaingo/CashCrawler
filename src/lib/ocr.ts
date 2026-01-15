/**
 * OCR utilities for reading virtual keyboard buttons
 *
 * Some banks (like Caisse d'Épargne) use virtual keyboards where
 * digits are displayed as images with randomized positions. This
 * module provides OCR capabilities to identify which button
 * corresponds to which digit.
 *
 * Requirements:
 * - Ollama must be installed and running
 * - The minicpm-v model must be pulled (ollama pull minicpm-v)
 */

import { ollamaOCR, DEFAULT_OCR_SYSTEM_PROMPT } from "ollama-ocr";

/**
 * Runs OCR on an image file to extract a numeric digit
 *
 * Uses the minicpm-v model via Ollama for vision-based OCR.
 * The model is optimized for recognizing single digits from
 * button images.
 *
 * @param imagePath Path to the image file (PNG)
 * @returns The recognized digit (0-9)
 * @throws Error if OCR fails or returns non-numeric result
 */
export async function recognizeDigit(imagePath: string): Promise<number> {
  const text = await ollamaOCR({
    model: "minicpm-v",
    filePath: imagePath,
    systemPrompt: DEFAULT_OCR_SYSTEM_PROMPT,
  });

  // Clean up common OCR mistakes:
  // - 'O' or 'o' often misread as '0'
  // - 'l' or 'I' often misread as '1'
  const cleaned = text
    .replace(/[Oo]/g, "0")
    .replace(/[lI]/g, "1")
    .replace(/\D/g, "");

  const digit = parseInt(cleaned, 10);

  if (isNaN(digit)) {
    throw new Error(`OCR did not return a valid number: "${text}"`);
  }

  return digit;
}

/**
 * Cleans up OCR results that may contain faulty multi-digit numbers
 *
 * Sometimes OCR returns multi-digit numbers instead of single digits
 * (e.g., "110011100" instead of "1"). This function attempts to fix
 * such cases by:
 *
 * 1. Keeping valid single digits (0-9) as-is
 * 2. For invalid entries, extracting candidate digits from the string
 * 3. Matching missing digits to faulty entries based on candidates
 *
 * @example
 * // Input: { 0: 0, 1: 8, 2: 7, 3: 110011100, 4: 4, 5: 6, 6: 5, 7: 3, 8: 210, 9: 9 }
 * // Output: { 0: 0, 1: 8, 2: 7, 3: 1, 4: 4, 5: 6, 6: 5, 7: 3, 8: 2, 9: 9 }
 *
 * @param digitMap Map of button index to detected digit value
 * @returns Cleaned map with single digits (0-9) for each button
 */
export function cleanDigitMap(
  digitMap: Record<number, number>
): Record<number, number> {
  const cleaned: Record<number, number> = {};
  const potentialMatches: Record<number, number[]> = {};

  // First pass: separate valid digits from faulty ones
  for (const [key, value] of Object.entries(digitMap)) {
    const numKey = Number(key);
    if (value >= 0 && value <= 9) {
      cleaned[numKey] = value;
    } else {
      // Extract individual digits from faulty multi-digit numbers
      const candidates = String(value)
        .split("")
        .map((d) => parseInt(d, 10))
        .filter((d) => d >= 0 && d <= 9);
      potentialMatches[numKey] = candidates;
      cleaned[numKey] = -1; // Mark as needing resolution
    }
  }

  // Find which digits 0-9 are missing from valid entries
  const presentDigits = new Set(Object.values(cleaned).filter((v) => v !== -1));
  const missingDigits = Array.from({ length: 10 }, (_, i) => i).filter(
    (i) => !presentDigits.has(i)
  );

  // Try to match missing digits with faulty buttons based on candidates
  for (const digit of missingDigits) {
    for (const key of Object.keys(cleaned)) {
      const numKey = Number(key);
      if (cleaned[numKey] === -1 && potentialMatches[numKey]?.includes(digit)) {
        cleaned[numKey] = digit;
        break;
      }
    }
  }

  // Fallback: assign any remaining missing digits to unmatched buttons
  for (const digit of missingDigits) {
    if (!Object.values(cleaned).includes(digit)) {
      for (const key of Object.keys(cleaned)) {
        const numKey = Number(key);
        if (cleaned[numKey] === -1) {
          cleaned[numKey] = digit;
          break;
        }
      }
    }
  }

  return cleaned;
}
