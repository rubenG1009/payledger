#!/usr/bin/env -S npx tsx
import { Keypair } from "@solana/web3.js";
import { createApi } from "./api.ts";
import { SolanaClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { syncAll } from "./indexer.ts";
import { solanaPayUrl } from "./pay-url.ts";
import { PgStore } from "./pg-store.ts";
import { fromBaseUnits, reconcile, toBaseUnits } from "./reconcile.ts";

export { solanaPayUrl };

const USAGE = `usage: payledger <command>
  init-db                                   create tables
  create-order <order-id> <amount> [label]  create an order with a fresh reference; print its Solana Pay URL
  new-reference <amount> [label]            create a bare reference (no order) and print a Solana Pay URL
  add-reference <pubkey> [label]            track an existing reference key
  sync                                      index new payments for every reference
  transfers [reference]                     list stored payments as JSON lines
  reconcile                                 print each order's status and any unmatched payments
  serve [port]                              start the HTTP API (default port 8080)`;

const json = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

async function main([command, ...args]: string[]) {
  if (!command || command === "help") return console.log(USAGE);
  const config = loadConfig();
  const store = PgStore.fromUrl(config.databaseUrl);
  if (command === "serve") {
    const port = Number(args[0] ?? 8080);
    const api = createApi(store, { merchant: config.merchant, mint: config.mint, decimals: config.decimals });
    api.listen(port, "127.0.0.1", () => console.log(`payledger API on http://127.0.0.1:${port}`));
    return;
  }
  try {
    switch (command) {
      case "init-db":
        await store.init();
        return console.log("schema ready");
      case "create-order": {
        const [orderId, amount, label] = args;
        if (!orderId || !amount) throw new Error("create-order needs <order-id> <amount>");
        const reference = Keypair.generate().publicKey.toBase58();
        const expected = toBaseUnits(amount, config.decimals);
        await store.createOrder({ orderId, reference, expected, label: label ?? null });
        return console.log(solanaPayUrl(config.merchant, amount, config.mint, reference, label));
      }
      case "new-reference": {
        const [amount, label] = args;
        if (!amount) throw new Error("new-reference needs an amount, e.g. 1.50");
        toBaseUnits(amount, config.decimals);
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
        for (const r of await syncAll(client, store, rule)) console.log(json(r));
        return;
      }
      case "transfers":
        for (const t of await store.listTransfers(args[0])) console.log(json(t));
        return;
      case "reconcile": {
        const { orders, unmatched } = reconcile(await store.listOrders(), await store.listTransfers());
        for (const o of orders) {
          const amounts = `${fromBaseUnits(o.received, config.decimals)} / ${fromBaseUnits(o.expected, config.decimals)}`;
          console.log(`${o.status.padEnd(9)} ${o.orderId}  ${amounts}  (${o.payments.length} payment(s))`);
        }
        for (const p of unmatched) console.log(`unmatched ${p.signature} ${fromBaseUnits(p.amount, config.decimals)}`);
        return;
      }
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
