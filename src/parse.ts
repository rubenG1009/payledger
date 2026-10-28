import type {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import type { PaymentTransfer } from "./types.ts";

export interface MatchRule {
  mint: string;
  recipientOwner: string;
}

interface TokenAccountInfo {
  mint: string;
  owner: string | undefined;
}

const TOKEN_PROGRAMS = new Set(["spl-token", "spl-token-2022"]);

type AnyInstruction = ParsedInstruction | PartiallyDecodedInstruction;

function isParsed(ix: AnyInstruction): ix is ParsedInstruction {
  return "parsed" in ix;
}

// Token balances are the only place an unchecked `transfer` reveals its mint and the recipient's owner.
function tokenAccounts(tx: ParsedTransactionWithMeta): Map<string, TokenAccountInfo> {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const accounts = new Map<string, TokenAccountInfo>();
  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    const key = keys[balance.accountIndex];
    if (key) accounts.set(key, { mint: balance.mint, owner: balance.owner });
  }
  return accounts;
}

function* allInstructions(tx: ParsedTransactionWithMeta): Generator<[string, AnyInstruction]> {
  const outer = tx.transaction.message.instructions;
  const inner = new Map((tx.meta?.innerInstructions ?? []).map((group) => [group.index, group.instructions]));
  for (const [i, ix] of outer.entries()) {
    yield [String(i), ix];
    for (const [j, innerIx] of (inner.get(i) ?? []).entries()) {
      yield [`${i}.${j}`, innerIx];
    }
  }
}

export function includesReference(tx: ParsedTransactionWithMeta, reference: string): boolean {
  return tx.transaction.message.accountKeys.some((k) => k.pubkey.toBase58() === reference);
}

/**
 * Returns the SPL-token transfers in `tx` that pay `rule.mint` to a token account owned by
 * `rule.recipientOwner`. Failed transactions and transactions without `reference` yield nothing.
 */
export function extractPayments(
  tx: ParsedTransactionWithMeta,
  signature: string,
  reference: string,
  rule: MatchRule,
): PaymentTransfer[] {
  if (tx.meta === null || tx.meta.err !== null || !includesReference(tx, reference)) return [];

  const accounts = tokenAccounts(tx);
  const payments: PaymentTransfer[] = [];
  for (const [index, ix] of allInstructions(tx)) {
    if (!isParsed(ix) || !TOKEN_PROGRAMS.has(ix.program)) continue;
    const { type, info } = ix.parsed as { type: string; info: Record<string, unknown> };
    if (type !== "transfer" && type !== "transferChecked") continue;

    const source = String(info.source);
    const destination = String(info.destination);
    const target = accounts.get(destination);
    const mint = typeof info.mint === "string" ? info.mint : target?.mint;
    const rawAmount =
      type === "transferChecked" ? (info.tokenAmount as { amount: string }).amount : String(info.amount);

    if (mint !== rule.mint || target?.owner !== rule.recipientOwner) continue;
    payments.push({
      signature,
      instructionIndex: index,
      reference,
      slot: tx.slot,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
      mint,
      source,
      destination,
      destinationOwner: target.owner,
      amount: BigInt(rawAmount),
    });
  }
  return payments;
}
