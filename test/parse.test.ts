import { describe, expect, it } from "vitest";
import { extractPayments } from "../src/parse.ts";
import { MERCHANT, MERCHANT_ATA, OTHER_MINT, PAYER_ATA, REFERENCE, USDC, key, paymentTx } from "./fixtures/tx.ts";

const rule = { mint: USDC, recipientOwner: MERCHANT };

describe("extractPayments", () => {
  it("reads a transferChecked payment to the merchant", () => {
    const [payment, ...rest] = extractPayments(paymentTx(), "sigA", REFERENCE, rule);
    expect(rest).toHaveLength(0);
    expect(payment).toMatchObject({
      signature: "sigA",
      instructionIndex: "1",
      reference: REFERENCE,
      slot: 100,
      mint: USDC,
      source: PAYER_ATA,
      destination: MERCHANT_ATA,
      destinationOwner: MERCHANT,
      amount: 1_500_000n,
    });
    expect(payment?.blockTime?.toISOString()).toBe("2025-10-27T21:20:00.000Z");
  });

  it("resolves the mint of an unchecked transfer from token balances", () => {
    const [payment] = extractPayments(paymentTx({ checked: false, amount: "42" }), "sigB", REFERENCE, rule);
    expect(payment?.amount).toBe(42n);
    expect(payment?.mint).toBe(USDC);
  });

  it("finds transfers inside inner instructions", () => {
    const [payment] = extractPayments(paymentTx({ inner: true }), "sigC", REFERENCE, rule);
    expect(payment?.instructionIndex).toBe("0.0");
  });

  it("keeps amounts above Number.MAX_SAFE_INTEGER exact", () => {
    const [payment] = extractPayments(paymentTx({ amount: "18446744073709551615" }), "sigD", REFERENCE, rule);
    expect(payment?.amount).toBe(18_446_744_073_709_551_615n);
  });

  it.each([
    ["a failed transaction", paymentTx({ failed: true }), REFERENCE, rule],
    ["another mint", paymentTx({ mint: OTHER_MINT }), REFERENCE, rule],
    ["a transaction without the reference", paymentTx({ withReference: false }), REFERENCE, rule],
    ["another recipient", paymentTx(), REFERENCE, { mint: USDC, recipientOwner: key(99) }],
  ])("ignores %s", (_label, tx, reference, matchRule) => {
    expect(extractPayments(tx, "sig", reference, matchRule)).toEqual([]);
  });
});
