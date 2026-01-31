/**
 * OCR utilities for reading virtual keyboard buttons
 *
 * Uses Tesseract.js for fast, lightweight OCR. Accepts image buffers
 * directly to avoid disk I/O overhead.
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
 * Recognizes digits from multiple image buffers in parallel
 */
export async function recognizeAllDigits(buffers: Buffer[]): Promise<number[]> {
  const w = await getWorker();
  const results = await Promise.all(
    buffers.map(async (buf) => {
      const { data } = await w.recognize(buf);
      return parseInt(data.text.trim(), 10);
    })
  );
  return results;
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
