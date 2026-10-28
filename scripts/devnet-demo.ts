// Devnet only: creates a throwaway SPL token and sends one Solana Pay-style payment that carries a
// reference key, so `payledger sync` has a real transaction to index. Keys live in .devnet/ (gitignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const DIR = ".devnet";
const DECIMALS = 6;

function loadOrCreate(name: string): Keypair {
  const path = `${DIR}/${name}.json`;
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const kp = Keypair.generate();
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
  return kp;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? clusterApiUrl("devnet");
  if (!rpcUrl.includes("devnet")) throw new Error("refusing to run outside devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = loadOrCreate("payer");
  const merchant = loadOrCreate("merchant");

  if ((await connection.getBalance(payer.publicKey)) < 0.2 * LAMPORTS_PER_SOL) {
    console.log(`airdropping 1 SOL to ${payer.publicKey.toBase58()}`);
    const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) });
  }

  const mintPath = `${DIR}/mint.txt`;
  const mint = existsSync(mintPath)
    ? new (await import("@solana/web3.js")).PublicKey(readFileSync(mintPath, "utf8").trim())
    : await createMint(connection, payer, payer.publicKey, null, DECIMALS);
  writeFileSync(mintPath, mint.toBase58());

  const from = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  const to = await getOrCreateAssociatedTokenAccount(connection, payer, mint, merchant.publicKey);
  await mintTo(connection, payer, mint, from.address, payer, 100n * 10n ** BigInt(DECIMALS));

  // Solana Pay: the reference is appended as a read-only, non-signer key of the transfer instruction.
  const reference = Keypair.generate().publicKey;
  const amount = 1_500_000n; // 1.5 tokens
  const ix = createTransferCheckedInstruction(from.address, mint, to.address, payer.publicKey, amount, DECIMALS);
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);

  console.log(`MERCHANT_WALLET=${merchant.publicKey.toBase58()}`);
  console.log(`MINT=${mint.toBase58()}`);
  console.log(`REFERENCE=${reference.toBase58()}`);
  console.log(`SIGNATURE=${signature}`);
  console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
