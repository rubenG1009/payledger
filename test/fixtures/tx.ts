import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";

export const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();

export const MERCHANT = key(1);
export const MERCHANT_ATA = key(2);
export const PAYER = key(3);
export const PAYER_ATA = key(4);
export const REFERENCE = key(5);
export const USDC = key(6);
export const OTHER_MINT = key(7);
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

interface TxOptions {
  slot?: number;
  mint?: string;
  amount?: string;
  checked?: boolean;
  failed?: boolean;
  withReference?: boolean;
  inner?: boolean;
}

// Shape of a jsonParsed SPL transfer as returned by getParsedTransaction.
export function paymentTx({
  slot = 100,
  mint = USDC,
  amount = "1500000",
  checked = true,
  failed = false,
  withReference = true,
  inner = false,
}: TxOptions = {}): ParsedTransactionWithMeta {
  const keys = [PAYER, PAYER_ATA, MERCHANT_ATA, mint, TOKEN_PROGRAM, ...(withReference ? [REFERENCE] : [])];
  const transfer = {
    program: "spl-token",
    programId: new PublicKey(TOKEN_PROGRAM),
    parsed: checked
      ? {
          type: "transferChecked",
          info: {
            source: PAYER_ATA,
            destination: MERCHANT_ATA,
            mint,
            authority: PAYER,
            tokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: "" },
          },
        }
      : { type: "transfer", info: { source: PAYER_ATA, destination: MERCHANT_ATA, authority: PAYER, amount } },
  };
  const memo = { program: "spl-memo", programId: new PublicKey(key(9)), parsed: "order 42" };
  const balance = (accountIndex: number, owner: string) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" },
  });

  return {
    slot,
    blockTime: 1_761_600_000,
    transaction: {
      signatures: ["sig"],
      message: {
        accountKeys: keys.map((k, i) => ({ pubkey: new PublicKey(k), signer: i === 0, writable: i < 3 })),
        instructions: inner ? [memo] : [memo, transfer],
        recentBlockhash: key(10),
      },
    },
    meta: {
      err: failed ? { InstructionError: [1, "Custom"] } : null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      innerInstructions: inner ? [{ index: 0, instructions: [transfer] }] : [],
      preTokenBalances: [balance(1, PAYER), balance(2, MERCHANT)],
      postTokenBalances: [balance(1, PAYER), balance(2, MERCHANT)],
    },
  } as unknown as ParsedTransactionWithMeta;
}
