// Amounts stay as raw base units (bigint); the service never converts to decimals or fiat.
export interface PaymentTransfer {
  signature: string;
  instructionIndex: string; // "3" for an outer instruction, "3.1" for an inner one
  reference: string;
  slot: number;
  blockTime: Date | null;
  mint: string;
  source: string;
  destination: string;
  destinationOwner: string;
  amount: bigint;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  failed: boolean;
}

export interface Cursor {
  signature: string;
  slot: number;
}
