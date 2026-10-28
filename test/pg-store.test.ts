import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgStore } from "../src/pg-store.ts";
import type { PaymentTransfer } from "../src/types.ts";
import { MERCHANT, MERCHANT_ATA, PAYER_ATA, REFERENCE, USDC } from "./fixtures/tx.ts";

// Runs only with a disposable database, e.g. `docker compose up -d db` and TEST_DATABASE_URL set.
const url = process.env.TEST_DATABASE_URL;

const transfer = (signature: string, amount: bigint): PaymentTransfer => ({
  signature,
  instructionIndex: "1",
  reference: REFERENCE,
  slot: 100,
  blockTime: new Date("2026-10-28T10:00:00Z"),
  mint: USDC,
  source: PAYER_ATA,
  destination: MERCHANT_ATA,
  destinationOwner: MERCHANT,
  amount,
});

describe.skipIf(!url)("PgStore", () => {
  let store: PgStore;

  beforeAll(async () => {
    store = PgStore.fromUrl(url!);
    await store.init();
    await store["pool"].query("TRUNCATE transfers, payment_references");
    await store.addReference(REFERENCE, "test");
  });

  afterAll(() => store.close());

  it("saves transfers and the cursor together, idempotently", async () => {
    const big = 18_446_744_073_709_551_615n;
    await store.saveBatch(REFERENCE, [transfer("a", 5n), transfer("b", big)], { signature: "b", slot: 101 });
    await store.saveBatch(REFERENCE, [transfer("b", big)], { signature: "b", slot: 101 });

    expect(await store.getCursor(REFERENCE)).toEqual({ signature: "b", slot: 101 });
    expect((await store.listTransfers(REFERENCE)).map((t) => t.amount)).toEqual([5n, big]);
  });

  it("rolls back the batch when a row is rejected", async () => {
    await expect(
      store.saveBatch(REFERENCE, [transfer("c", 1n), transfer("d", -1n)], { signature: "d", slot: 102 }),
    ).rejects.toThrow();
    expect(await store.getCursor(REFERENCE)).toEqual({ signature: "b", slot: 101 });
    expect((await store.listTransfers()).map((t) => t.signature)).toEqual(["a", "b"]);
  });
});
