import { Connection, PublicKey, type Finality, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { SignatureInfo } from "./types.ts";

export interface SignaturePage {
  before?: string;
  until?: string;
  limit: number;
}

export interface ChainClient {
  // Newest first, as returned by getSignaturesForAddress.
  signaturesFor(address: string, page: SignaturePage): Promise<SignatureInfo[]>;
  parsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null>;
}

export class SolanaClient implements ChainClient {
  private readonly connection: Connection;

  constructor(
    rpcUrl: string,
    private readonly commitment: Finality = "finalized",
  ) {
    this.connection = new Connection(rpcUrl, commitment);
  }

  async signaturesFor(address: string, page: SignaturePage): Promise<SignatureInfo[]> {
    const rows = await this.connection.getSignaturesForAddress(new PublicKey(address), page, this.commitment);
    return rows.map((r) => ({ signature: r.signature, slot: r.slot, failed: r.err !== null }));
  }

  parsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    // Devnet already carries v1 transactions; asking for less makes the RPC reject them outright.
    return this.connection.getParsedTransaction(signature, {
      commitment: this.commitment,
      maxSupportedTransactionVersion: 1,
    });
  }
}
