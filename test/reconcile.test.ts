import { describe, expect, it } from "vitest";
import { fromBaseUnits, orderStatus, reconcile, toBaseUnits, type Order } from "../src/reconcile.ts";
import type { PaymentTransfer } from "../src/types.ts";
import { key } from "./fixtures/tx.ts";

const payment = (reference: string, amount: bigint, signature = `sig-${reference}-${amount}`): PaymentTransfer => ({
  signature,
  instructionIndex: "0",
  reference,
  slot: 1,
  blockTime: null,
  mint: key(6),
  source: key(4),
  destination: key(2),
  destinationOwner: key(1),
  amount,
});

const order = (orderId: string, reference: string, expected: bigint): Order => ({
  orderId,
  reference,
  expected,
  label: null,
});

describe("orderStatus", () => {
  it.each([
    [100n, 0n, "pending"],
    [100n, 40n, "underpaid"],
    [100n, 100n, "paid"],
    [100n, 101n, "overpaid"],
  ] as const)("expected %s, received %s → %s", (expected, received, status) => {
    expect(orderStatus(expected, received)).toBe(status);
  });
});

describe("reconcile", () => {
  it("sums split payments per reference and reports what no order claims", () => {
    const [a, b, c, orphan] = [key(20), key(21), key(22), key(23)];
    const result = reconcile(
      [order("A", a, 100n), order("B", b, 100n), order("C", c, 50n)],
      [payment(a, 60n), payment(a, 40n), payment(b, 30n), payment(orphan, 7n)],
    );

    expect(result.orders.map((o) => [o.orderId, o.received, o.status])).toEqual([
      ["A", 100n, "paid"],
      ["B", 30n, "underpaid"],
      ["C", 0n, "pending"],
    ]);
    expect(result.orders[0]?.payments).toHaveLength(2);
    expect(result.unmatched.map((p) => p.amount)).toEqual([7n]);
  });
});

describe("base units", () => {
  it("converts decimals exactly", () => {
    expect(toBaseUnits("1.5", 6)).toBe(1_500_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(toBaseUnits("123456789012.123456", 6)).toBe(123_456_789_012_123_456n);
    expect(fromBaseUnits(1_500_000n, 6)).toBe("1.5");
    expect(fromBaseUnits(1n, 6)).toBe("0.000001");
    expect(fromBaseUnits(42_000_000n, 6)).toBe("42");
  });

  it("rejects malformed or over-precise amounts", () => {
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(/more than 6 decimals/);
    expect(() => toBaseUnits("-1", 6)).toThrow(/invalid/);
    expect(() => toBaseUnits("1e3", 6)).toThrow(/invalid/);
  });
});
