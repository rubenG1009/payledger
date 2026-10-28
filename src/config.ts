import { PublicKey, type Finality } from "@solana/web3.js";

// Circle's devnet USDC mint; override MINT for any other SPL token.
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export interface Config {
  rpcUrl: string;
  databaseUrl: string;
  merchant: string;
  mint: string;
  decimals: number;
  commitment: Finality;
}

function publicKey(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${name} is not a valid Solana public key: ${value}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const commitment = env.COMMITMENT ?? "finalized";
  if (commitment !== "finalized" && commitment !== "confirmed") {
    throw new Error("COMMITMENT must be 'finalized' or 'confirmed'");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const decimals = Number(env.MINT_DECIMALS ?? 6);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("MINT_DECIMALS must be 0-18");
  return {
    decimals,
    rpcUrl: env.RPC_URL ?? "https://api.devnet.solana.com",
    databaseUrl: env.DATABASE_URL,
    merchant: publicKey("MERCHANT_WALLET", env.MERCHANT_WALLET),
    mint: publicKey("MINT", env.MINT ?? DEVNET_USDC),
    commitment,
  };
}
