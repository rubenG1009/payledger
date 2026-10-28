#!/usr/bin/env -S npx tsx
import { Keypair } from "@solana/web3.js";
import { SolanaClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { syncAll } from "./indexer.ts";
import { PgStore } from "./pg-store.ts";

const USAGE = `usage: payledger <command>
  init-db                          create tables
  new-reference <amount> [label]   create a reference key and print a Solana Pay URL
  add-reference <pubkey> [label]   track an existing reference key
  sync                             index new payments for every reference
  transfers [reference]            list stored payments as JSON lines`;

// Solana Pay transfer request: https://docs.solanapay.com/spec
export function solanaPayUrl(recipient: string, amount: string, mint: string, reference: string, label?: string) {
  const params = new URLSearchParams({ amount, "spl-token": mint, reference });
  if (label) params.set("label", label);
  return `solana:${recipient}?${params}`;
}

async function main([command, ...args]: string[]) {
  if (!command || command === "help") return console.log(USAGE);
  const config = loadConfig();
  const store = PgStore.fromUrl(config.databaseUrl);
  try {
    switch (command) {
      case "init-db":
        await store.init();
        return console.log("schema ready");
      case "new-reference": {
        const [amount, label] = args;
        if (!amount || !/^\d+(\.\d+)?$/.test(amount)) throw new Error("amount must be a decimal, e.g. 1.50");
        const reference = Keypair.generate().publicKey.toBase58();
        await store.addReference(reference, label);
        return console.log(solanaPayUrl(config.merchant, amount, config.mint, reference, label));
      }
      case "add-reference": {
        const [reference, label] = args;
        if (!reference) throw new Error("add-reference needs a public key");
        await store.addReference(reference, label);
        return console.log(`tracking ${reference}`);
      }
      case "sync": {
        const client = new SolanaClient(config.rpcUrl, config.commitment);
        const rule = { mint: config.mint, recipientOwner: config.merchant };
        for (const r of await syncAll(client, store, rule)) console.log(JSON.stringify(r));
        return;
      }
      case "transfers":
        for (const t of await store.listTransfers(args[0])) {
          console.log(JSON.stringify({ ...t, amount: t.amount.toString() }));
        }
        return;
      default:
        throw new Error(`unknown command: ${command}\n${USAGE}`);
    }
  } finally {
    await store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
