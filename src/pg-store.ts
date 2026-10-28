import { readFile } from "node:fs/promises";
import pg from "pg";
import type { Order } from "./reconcile.ts";
import type { Store } from "./store.ts";
import type { Cursor, PaymentTransfer } from "./types.ts";

export class OrderExistsError extends Error {
  constructor(orderId: string) {
    super(`order ${orderId} already exists`);
    this.name = "OrderExistsError";
  }
}

interface TransferRow {
  signature: string;
  instruction_index: string;
  reference: string;
  slot: string;
  block_time: Date | null;
  mint: string;
  source: string;
  destination: string;
  destination_owner: string;
  amount: string;
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  static fromUrl(url: string): PgStore {
    return new PgStore(new pg.Pool({ connectionString: url }));
  }

  async init(): Promise<void> {
    await this.pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  }

  async addReference(reference: string, label?: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO payment_references (reference, label) VALUES ($1, $2) ON CONFLICT (reference) DO NOTHING",
      [reference, label ?? null],
    );
  }

  async listReferences(): Promise<string[]> {
    const { rows } = await this.pool.query<{ reference: string }>(
      "SELECT reference FROM payment_references ORDER BY created_at",
    );
    return rows.map((r) => r.reference);
  }

  async getCursor(reference: string): Promise<Cursor | null> {
    const { rows } = await this.pool.query<{ last_signature: string | null; last_slot: string | null }>(
      "SELECT last_signature, last_slot FROM payment_references WHERE reference = $1",
      [reference],
    );
    const row = rows[0];
    return row?.last_signature ? { signature: row.last_signature, slot: Number(row.last_slot) } : null;
  }

  async saveBatch(reference: string, transfers: PaymentTransfer[], cursor: Cursor): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const t of transfers) {
        await client.query(
          `INSERT INTO transfers (signature, instruction_index, reference, slot, block_time, mint, source,
                                  destination, destination_owner, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (signature, instruction_index) DO NOTHING`,
          [t.signature, t.instructionIndex, t.reference, t.slot, t.blockTime, t.mint, t.source,
            t.destination, t.destinationOwner, t.amount.toString()],
        );
      }
      await client.query(
        "UPDATE payment_references SET last_signature = $2, last_slot = $3 WHERE reference = $1",
        [reference, cursor.signature, cursor.slot],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTransfers(reference?: string): Promise<PaymentTransfer[]> {
    const { rows } = await this.pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE $1::text IS NULL OR reference = $1 ORDER BY slot, signature, instruction_index`,
      [reference ?? null],
    );
    return rows.map((r) => ({
      signature: r.signature,
      instructionIndex: r.instruction_index,
      reference: r.reference,
      slot: Number(r.slot),
      blockTime: r.block_time,
      mint: r.mint,
      source: r.source,
      destination: r.destination,
      destinationOwner: r.destination_owner,
      amount: BigInt(r.amount),
    }));
  }

  // Creates the order and its reference together; a duplicate order id raises OrderExistsError.
  async createOrder(order: Order): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO payment_references (reference, label) VALUES ($1, $2)", [
        order.reference,
        order.label,
      ]);
      await client.query("INSERT INTO orders (order_id, reference, expected, label) VALUES ($1, $2, $3, $4)", [
        order.orderId,
        order.reference,
        order.expected.toString(),
        order.label,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new OrderExistsError(order.orderId);
      throw error;
    } finally {
      client.release();
    }
  }

  async listOrders(orderId?: string): Promise<Order[]> {
    const { rows } = await this.pool.query<{ order_id: string; reference: string; expected: string; label: string | null }>(
      "SELECT order_id, reference, expected, label FROM orders WHERE $1::text IS NULL OR order_id = $1 ORDER BY created_at",
      [orderId ?? null],
    );
    return rows.map((r) => ({ orderId: r.order_id, reference: r.reference, expected: BigInt(r.expected), label: r.label }));
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
