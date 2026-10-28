# PayLedger

Open-source payment reconciliation for **Solana Pay** merchants, in TypeScript.

A Solana Pay checkout gives every order a unique `reference` public key, which the
payer's wallet attaches to the transfer. PayLedger follows those reference keys,
stores the SPL-token payments that reach the merchant's wallet in PostgreSQL, keeps
a per-reference cursor so a restart never skips a payment, and tells the merchant
whether each order is `pending`, `paid`, `underpaid` or `overpaid`.

Status: **milestones 1 (indexer) and 2 (reconciliation API) done**; milestone 3 is a
demo store and docs. Devnet first; the service only reads the chain and never holds
keys or funds.

## How it works

- `getSignaturesForAddress(reference)` is paged back to the stored cursor, then
  replayed oldest first.
- Each transaction is read with `getParsedTransaction` at `finalized` commitment
  (`confirmed` is allowed for demos). Failed transactions are skipped.
- A payment is an SPL `transfer` or `transferChecked`, outer or inner instruction,
  of the configured mint into a token account **owned by** `MERCHANT_WALLET`. The
  owner and the mint of an unchecked `transfer` come from the transaction's token
  balances.
- Amounts stay as raw base units (`bigint` in TypeScript, `numeric(39,0)` in
  PostgreSQL); nothing is converted to decimals or fiat.
- If the RPC cannot return a transaction yet, the cursor stops before it and the
  next `sync` retries. Transfers and the cursor are committed in one transaction.
- A key with more than 1,000 new signatures is rejected: references are single-use,
  so that usually means a program id or a busy account was registered by mistake.

## Quick start

Requirements: Node 20+ and Docker with Compose.

```sh
npm install
cp .env.example .env            # set MERCHANT_WALLET
docker compose up -d --wait db
set -a; . ./.env; set +a
npm run cli -- init-db
npm run cli -- create-order order-42 1.50 "Coffee"   # prints a solana: payment URL
npm run cli -- sync
npm run cli -- reconcile
npm run cli -- serve 8080                            # HTTP API on 127.0.0.1
```

`add-reference <pubkey>` tracks a reference created elsewhere (for example by your
checkout); payments on it without an order are reported as `unmatched`.

## HTTP API

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/orders` | `{"orderId", "amount": "1.50", "label"?}` → 201 with a fresh `reference` and the Solana Pay `url`; 409 if the id exists |
| `GET` | `/orders/:id` | expected and received amounts (base units and decimal), `status`, and the payments |
| `GET` | `/reconciliation[?status=underpaid]` | every order's status plus `unmatched` payments |
| `GET` | `/health` | `{"ok": true}` |

Amounts are decimal strings in requests and converted exactly with `MINT_DECIMALS`
(default 6); a split payment counts towards the same order. The server binds to
127.0.0.1 and has no authentication yet: put it behind your own backend.

## Tests

```sh
npm run typecheck
npm test                                         # unit tests, no network
TEST_DATABASE_URL=postgres://payledger:payledger@localhost:5433/payledger npm test
```

`scripts/live-parse-check.ts` is a read-only check that runs the parser against
recent devnet-USDC transactions. `scripts/devnet-demo.ts` creates a throwaway devnet
token and sends one Solana Pay-style payment with a reference key; it needs devnet
SOL from [faucet.solana.com](https://faucet.solana.com) and keeps its keys in
`.devnet/` (gitignored).

## Verified on devnet

On 2026-10-28 `scripts/devnet-demo.ts` sent a 1.5-token `transferChecked` with a
reference key ([transaction](https://explorer.solana.com/tx/3PFpoEKbiggJQxyLixvZcQt9HaXDfyJTXMmEh6qrQvo8j75kqMowJJ62Pjn4kGopibu4cpsNezUKbGzHpVPCrE83?cluster=devnet)).
`sync` stored it as one payment of `1500000` base units to the merchant wallet; a
second `sync` saw no new signatures and left the table at one row. The token is a
throwaway devnet mint, not USDC.

Milestone 2 was checked the same day: three orders created through `POST /orders`,
then one exact payment ([tx](https://explorer.solana.com/tx/jkdfbCoDUimYdupzDJNzE7aAqqtuzBU2vjU63hpDeUt4VCrf4Sae2GVds9h47bqiHm835nPng2DiodE9XF1AGrb?cluster=devnet)),
one partial payment ([tx](https://explorer.solana.com/tx/28UBmNFEzzBqPPeDAutpnS2MBqfbEGShab5FHuu2LUU6r9kU6r6uR3fgoyP18kreA6eDe4zpTTPqfXm7MP41dtDh?cluster=devnet))
and none for the third. After `sync`, both the CLI and `GET /reconciliation`
reported `paid 2.5 / 2.5`, `underpaid 6 / 10` and `pending 0 / 4`.

## Limits

- Devnet only so far; not audited.
- One mint and one merchant wallet per deployment.
- A transaction that carries two tracked references is stored under the first one
  indexed.

## License

MIT
