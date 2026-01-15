/**
 * Shared type definitions for bank connectors
 *
 * These types are used across all connectors to ensure consistency
 * in how account data is represented and stored.
 */

/**
 * Represents a bank account with its current balance
 */
export interface AccountBalance {
  /** Display name of the account (e.g., "Livret A", "Compte Courant") */
  account: string;
  /** Current balance in the account's currency (typically EUR) */
  balance: number;
}

/**
 * Bank identifiers used in file paths and storage
 *
 * When adding a new bank connector, add its identifier here.
 * Use lowercase, hyphenated names (e.g., "my-bank").
 */
export const BANK_IDS = {
  CAISSE_EPARGNE: "ce",
  UAF_LIFE: "uaf",
} as const;

export type BankId = (typeof BANK_IDS)[keyof typeof BANK_IDS];
