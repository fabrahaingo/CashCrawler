/**
 * Simple console spinner for long-running operations
 *
 * Displays an animated spinner to indicate that work is in progress.
 * Helps users understand the app hasn't frozen during slow operations
 * like OCR or waiting for 2FA.
 *
 * Usage:
 *   const spinner = createSpinner("Processing...");
 *   spinner.start();
 *   await doSlowWork();
 *   spinner.stop("Done!");
 */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL = 80; // ms between frames

export interface Spinner {
  start: () => void;
  stop: (finalMessage?: string) => void;
}

/**
 * Creates a spinner with the given message
 *
 * @param message Text to display next to the spinner
 * @returns Spinner object with start() and stop() methods
 */
export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let intervalId: NodeJS.Timeout | null = null;

  const start = () => {
    // Don't start if already running
    if (intervalId) return;

    // Hide cursor for cleaner animation
    process.stdout.write("\x1B[?25l");

    intervalId = setInterval(() => {
      const frame = SPINNER_FRAMES[frameIndex];
      process.stdout.write(`\r${frame} ${message}`);
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    }, FRAME_INTERVAL);
  };

  const stop = (finalMessage?: string) => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // Clear the line and show final message
    process.stdout.write("\r\x1B[K"); // Clear line
    process.stdout.write("\x1B[?25h"); // Show cursor

    if (finalMessage) {
      console.log(finalMessage);
    }
  };

  return { start, stop };
}

/**
 * Wraps an async operation with a spinner
 *
 * Convenience function that handles start/stop automatically.
 *
 * @param message Message to show while loading
 * @param operation Async function to execute
 * @param successMessage Optional message to show on completion
 * @returns Result of the operation
 */
export async function withSpinner<T>(
  message: string,
  operation: () => Promise<T>,
  successMessage?: string
): Promise<T> {
  const spinner = createSpinner(message);
  spinner.start();

  try {
    const result = await operation();
    spinner.stop(successMessage);
    return result;
  } catch (error) {
    spinner.stop(); // Clear spinner before error is thrown
    throw error;
  }
}
