import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { ChainClient, SignaturePage } from "../src/client.ts";
import { syncReference } from "../src/indexer.ts";
import { MemoryStore } from "../src/store.ts";
import type { SignatureInfo } from "../src/types.ts";
import { MERCHANT, REFERENCE, USDC, paymentTx } from "./fixtures/tx.ts";

const rule = { mint: USDC, recipientOwner: MERCHANT };

// Mimics getSignaturesForAddress: newest first, `before`/`until` exclusive.
class FakeChain implements ChainClient {
  readonly txs = new Map<string, ParsedTransactionWithMeta | null>();
  readonly sigs: SignatureInfo[] = []; // oldest first
  fetched: string[] = [];

  add(signature: string, tx: ParsedTransactionWithMeta | null, failed = false) {
    this.sigs.push({ signature, slot: 100 + this.sigs.length, failed });
    this.txs.set(signature, tx);
  }

  async signaturesFor(_address: string, { before, until, limit }: SignaturePage) {
    let newest = [...this.sigs].reverse();
    if (before) newest = newest.slice(newest.findIndex((s) => s.signature === before) + 1);
    if (until) newest = newest.slice(0, newest.findIndex((s) => s.signature === until));
    return newest.slice(0, limit);
  }

  async parsedTransaction(signature: string) {
    this.fetched.push(signature);
    return this.txs.get(signature) ?? null;
  }
}

describe("syncReference", () => {
  it("stores payments oldest first and resumes from the cursor", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    chain.add("s1", paymentTx({ slot: 100, amount: "10" }));
    chain.add("s2", paymentTx({ slot: 101, amount: "20" }));

    const first = await syncReference(chain, store, REFERENCE, rule);
    expect(first).toMatchObject({ seen: 2, payments: 2, caughtUp: true, cursor: { signature: "s2" } });

    chain.fetched = [];
    chain.add("s3", paymentTx({ slot: 102, amount: "30" }));
    const second = await syncReference(chain, store, REFERENCE, rule);
    expect(second).toMatchObject({ seen: 1, payments: 1 });
    expect(chain.fetched).toEqual(["s3"]);
    expect((await store.listTransfers()).map((t) => t.amount)).toEqual([10n, 20n, 30n]);
  });

  it("follows pagination back to the cursor", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    for (let i = 0; i < 7; i++) chain.add(`s${i}`, paymentTx({ slot: 100 + i }));

    const result = await syncReference(chain, store, REFERENCE, rule, { pageSize: 3 });
    expect(result.seen).toBe(7);
    expect(chain.fetched).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
  });

  it("skips failed signatures without fetching them but still advances", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    chain.add("bad", paymentTx(), true);
    chain.add("good", paymentTx());

    const result = await syncReference(chain, store, REFERENCE, rule);
    expect(chain.fetched).toEqual(["good"]);
    expect(result).toMatchObject({ payments: 1, cursor: { signature: "good" } });
  });

  it("stops before a transaction the RPC cannot return yet, so the next run retries it", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    chain.add("s1", paymentTx({ amount: "1" }));
    chain.add("pending", null);
    chain.add("s3", paymentTx({ amount: "3" }));

    const first = await syncReference(chain, store, REFERENCE, rule);
    expect(first).toMatchObject({ caughtUp: false, payments: 1, cursor: { signature: "s1" } });

    chain.txs.set("pending", paymentTx({ amount: "2" }));
    const second = await syncReference(chain, store, REFERENCE, rule);
    expect(second).toMatchObject({ caughtUp: true, payments: 2, cursor: { signature: "s3" } });
    expect((await store.listTransfers()).map((t) => t.amount)).toEqual([1n, 2n, 3n]);
  });

  it("refuses a key with too many signatures instead of paging forever", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    for (let i = 0; i < 12; i++) chain.add(`s${i}`, paymentTx());

    await expect(syncReference(chain, store, REFERENCE, rule, { pageSize: 5, maxSignatures: 8 })).rejects.toThrow(
      /more than 8 new signatures/,
    );
    expect(chain.fetched).toEqual([]);
    expect(await store.getCursor(REFERENCE)).toBeNull();
  });

  it("does not write when there is nothing new", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore([REFERENCE]);
    const result = await syncReference(chain, store, REFERENCE, rule);
    expect(result).toMatchObject({ seen: 0, cursor: null });
    expect(await store.getCursor(REFERENCE)).toBeNull();
  });
});
