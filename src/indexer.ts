import type { ChainClient } from "./client.ts";
import { extractPayments, type MatchRule } from "./parse.ts";
import type { Store } from "./store.ts";
import type { Cursor, PaymentTransfer, SignatureInfo } from "./types.ts";

export interface SyncOptions {
  pageSize?: number;
  // Safety cap: a Solana Pay reference is single-use, so thousands of signatures mean the key is not a
  // reference (e.g. a program id) and paging further would only hammer the RPC.
  maxSignatures?: number;
}

export interface SyncResult {
  reference: string;
  seen: number;
  payments: number;
  cursor: Cursor | null;
  // False when a transaction was not yet available at the configured commitment; the next run resumes there.
  caughtUp: boolean;
}

async function newSignatures(
  client: ChainClient,
  reference: string,
  until: string | undefined,
  { pageSize = 100, maxSignatures = 1_000 }: SyncOptions,
): Promise<SignatureInfo[]> {
  const newestFirst: SignatureInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await client.signaturesFor(reference, { before, until, limit: pageSize });
    newestFirst.push(...page);
    if (newestFirst.length > maxSignatures) {
      throw new Error(`reference ${reference} has more than ${maxSignatures} new signatures`);
    }
    const last = page.at(-1);
    if (page.length < pageSize || last === undefined) break;
    before = last.signature;
  }
  return newestFirst.reverse();
}

/**
 * Reads every signature after the stored cursor, oldest first, and stores matching payments.
 * The cursor only advances past transactions that were fetched, so a restart never skips one.
 */
export async function syncReference(
  client: ChainClient,
  store: Store,
  reference: string,
  rule: MatchRule,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const start = await store.getCursor(reference);
  const signatures = await newSignatures(client, reference, start?.signature, options);

  const payments: PaymentTransfer[] = [];
  let cursor = start;
  let caughtUp = true;
  for (const sig of signatures) {
    if (!sig.failed) {
      const tx = await client.parsedTransaction(sig.signature);
      if (tx === null) {
        caughtUp = false;
        break;
      }
      payments.push(...extractPayments(tx, sig.signature, reference, rule));
    }
    cursor = { signature: sig.signature, slot: sig.slot };
  }

  if (cursor !== null && cursor !== start) await store.saveBatch(reference, payments, cursor);
  return { reference, seen: signatures.length, payments: payments.length, cursor, caughtUp };
}

export async function syncAll(client: ChainClient, store: Store, rule: MatchRule, options?: SyncOptions) {
  const results: SyncResult[] = [];
  for (const reference of await store.listReferences()) {
    results.push(await syncReference(client, store, reference, rule, options));
  }
  return results;
}
