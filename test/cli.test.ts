import { describe, expect, it } from "vitest";
import { solanaPayUrl } from "../src/pay-url.ts";
import { loadConfig } from "../src/config.ts";
import { MERCHANT, REFERENCE, USDC } from "./fixtures/tx.ts";

describe("solanaPayUrl", () => {
  it("builds a transfer request with the reference key", () => {
    const url = new URL(solanaPayUrl(MERCHANT, "1.50", USDC, REFERENCE, "Order 42"));
    expect(url.protocol).toBe("solana:");
    expect(url.pathname).toBe(MERCHANT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      amount: "1.50",
      "spl-token": USDC,
      reference: REFERENCE,
      label: "Order 42",
    });
  });
});

describe("loadConfig", () => {
  const base = { DATABASE_URL: "postgres://x", MERCHANT_WALLET: MERCHANT };

  it("defaults to devnet, devnet USDC and finalized", () => {
    expect(loadConfig(base)).toMatchObject({
      rpcUrl: "https://api.devnet.solana.com",
      mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      commitment: "finalized",
    });
  });

  it("rejects an invalid merchant key and processed commitment", () => {
    expect(() => loadConfig({ ...base, MERCHANT_WALLET: "nope" })).toThrow(/MERCHANT_WALLET/);
    expect(() => loadConfig({ ...base, COMMITMENT: "processed" })).toThrow(/COMMITMENT/);
  });
});
