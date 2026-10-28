# PayLedger

Open-source payment reconciliation for **Solana Pay** merchants, in TypeScript.

A Solana Pay checkout gives every order a unique `reference` public key, which the
payer's wallet attaches to the transfer. PayLedger follows those reference keys,
stores the SPL-token payments that reach the merchant's wallet in PostgreSQL, and
keeps a per-reference cursor so a restart never skips a payment.

Status: **milestone 1 (indexer)**. Matching payments against orders (`paid`,
`underpaid`, `overpaid`, `unmatched`) is the next milestone. Devnet first; the
service only reads the chain and never holds keys or funds.

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
npm run cli -- new-reference 1.50 "Order 42"   # prints a solana: payment URL
npm run cli -- sync
npm run cli -- transfers
```

`add-reference <pubkey>` tracks a reference created elsewhere (for example by your
checkout).

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

## Limits

- Devnet only so far; not audited.
- One mint and one merchant wallet per deployment.
- A transaction that carries two tracked references is stored under the first one
  indexed.

## License

MIT
