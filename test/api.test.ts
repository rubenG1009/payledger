import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi, type Ledger } from "../src/api.ts";
import type { Order } from "../src/reconcile.ts";
import type { PaymentTransfer } from "../src/types.ts";
import { MERCHANT, USDC, key } from "./fixtures/tx.ts";

class MemoryLedger implements Ledger {
  orders: Order[] = [];
  transfers: PaymentTransfer[] = [];

  async createOrder(order: Order) {
    if (this.orders.some((o) => o.orderId === order.orderId)) throw new Error(`order ${order.orderId} already exists`);
    this.orders.push(order);
  }
  async listOrders(orderId?: string) {
    return this.orders.filter((o) => orderId === undefined || o.orderId === orderId);
  }
  async listTransfers(reference?: string) {
    return this.transfers.filter((t) => reference === undefined || t.reference === reference);
  }
}

const pay = (reference: string, amount: bigint): PaymentTransfer => ({
  signature: `sig-${amount}`,
  instructionIndex: "0",
  reference,
  slot: 1,
  blockTime: null,
  mint: USDC,
  source: key(4),
  destination: key(2),
  destinationOwner: MERCHANT,
  amount,
});

describe("HTTP API", () => {
  let ledger: MemoryLedger;
  let base: string;
  let close: () => void;
  let refs: string[];

  beforeEach(async () => {
    ledger = new MemoryLedger();
    refs = [key(30), key(31), key(32)];
    const server = createApi(ledger, { merchant: MERCHANT, mint: USDC, decimals: 6, newReference: () => refs.shift()! });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterEach(() => close());

  const post = (body: unknown) =>
    fetch(`${base}/orders`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("creates an order with a fresh reference and a Solana Pay URL", async () => {
    const res = await post({ orderId: "order-42", amount: "1.50", label: "Coffee" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ orderId: "order-42", reference: key(30), expected: "1500000", expectedDisplay: "1.50" });
    expect(new URL(body.url).searchParams.get("reference")).toBe(key(30));
    expect(ledger.orders[0]?.expected).toBe(1_500_000n);
  });

  it("rejects duplicates and bad input", async () => {
    await post({ orderId: "a", amount: "1" });
    expect((await post({ orderId: "a", amount: "1" })).status).toBe(409);
    expect((await post({ orderId: "bad id!", amount: "1" })).status).toBe(400);
    expect((await post({ orderId: "b", amount: 1 })).status).toBe(400);
    expect((await post({ orderId: "c", amount: "0" })).status).toBe(400);
    expect((await post({ orderId: "d", amount: "1.0000001" })).status).toBe(400);
    const notJson = await fetch(`${base}/orders`, { method: "POST", body: "nope" });
    expect(notJson.status).toBe(400);
  });

  it("reports an order's payments and status", async () => {
    await post({ orderId: "o1", amount: "2" });
    ledger.transfers.push(pay(key(30), 500_000n));

    const res = await fetch(`${base}/orders/o1`);
    expect(await res.json()).toMatchObject({
      status: "underpaid",
      expected: "2000000",
      received: "500000",
      receivedDisplay: "0.5",
      payments: [{ amount: "500000" }],
    });
    expect((await fetch(`${base}/orders/missing`)).status).toBe(404);
  });

  it("lists the reconciliation, filters by status and shows unmatched payments", async () => {
    await post({ orderId: "paid", amount: "1" });
    await post({ orderId: "waiting", amount: "1" });
    ledger.transfers.push(pay(key(30), 1_000_000n), pay(key(99), 7n));

    const all = await (await fetch(`${base}/reconciliation`)).json();
    expect(all.orders.map((o: { orderId: string; status: string }) => [o.orderId, o.status])).toEqual([
      ["paid", "paid"],
      ["waiting", "pending"],
    ]);
    expect(all.unmatched).toHaveLength(1);

    const pending = await (await fetch(`${base}/reconciliation?status=pending`)).json();
    expect(pending.orders.map((o: { orderId: string }) => o.orderId)).toEqual(["waiting"]);
  });

  it("answers health checks and 404s", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
