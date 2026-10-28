import type { Cursor, PaymentTransfer } from "./types.ts";

export interface Store {
  listReferences(): Promise<string[]>;
  getCursor(reference: string): Promise<Cursor | null>;
  // Must be atomic: transfers and the advanced cursor are committed together or not at all.
  saveBatch(reference: string, transfers: PaymentTransfer[], cursor: Cursor): Promise<void>;
  listTransfers(reference?: string): Promise<PaymentTransfer[]>;
}

export class MemoryStore implements Store {
  private readonly cursors = new Map<string, Cursor | null>();
  private readonly transfers = new Map<string, PaymentTransfer>();

  constructor(references: string[] = []) {
    for (const reference of references) this.cursors.set(reference, null);
  }

  async listReferences(): Promise<string[]> {
    return [...this.cursors.keys()];
  }

  async getCursor(reference: string): Promise<Cursor | null> {
    return this.cursors.get(reference) ?? null;
  }

  async saveBatch(reference: string, transfers: PaymentTransfer[], cursor: Cursor): Promise<void> {
    for (const t of transfers) this.transfers.set(`${t.signature}#${t.instructionIndex}`, t);
    this.cursors.set(reference, cursor);
  }

  async listTransfers(reference?: string): Promise<PaymentTransfer[]> {
    return [...this.transfers.values()]
      .filter((t) => reference === undefined || t.reference === reference)
      .sort((a, b) => a.slot - b.slot);
  }
}
