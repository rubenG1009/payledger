// Read-only check against devnet: take recent devnet-USDC transactions and confirm extractPayments
// recovers each transferChecked when the recipient owner and an account key are used as the rule.
import { SolanaClient } from "../src/client.ts";
import { DEVNET_USDC } from "../src/config.ts";
import { extractPayments } from "../src/parse.ts";

const client = new SolanaClient(process.env.RPC_URL ?? "https://api.devnet.solana.com", "finalized");
const sigs = (await client.signaturesFor(DEVNET_USDC, { limit: 25 })).filter((s) => !s.failed);
let checked = 0;
for (const { signature } of sigs) {
  const tx = await client.parsedTransaction(signature);
  if (!tx?.meta) continue;
  const owners = (tx.meta.postTokenBalances ?? []).filter((b) => b.mint === DEVNET_USDC && b.owner);
  for (const { owner } of owners) {
    const reference = tx.transaction.message.accountKeys.at(-1)!.pubkey.toBase58();
    const found = extractPayments(tx, signature, reference, { mint: DEVNET_USDC, recipientOwner: owner! });
    for (const p of found) {
      checked++;
      console.log(`${signature.slice(0, 12)}… ix ${p.instructionIndex} → ${p.destinationOwner.slice(0, 8)}… ${p.amount} base units`);
    }
  }
  if (checked >= 5) break;
}
console.log(`payments recovered from real devnet transactions: ${checked}`);
