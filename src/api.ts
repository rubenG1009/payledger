import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Keypair } from "@solana/web3.js";
import { solanaPayUrl } from "./pay-url.ts";
import { fromBaseUnits, reconcile, toBaseUnits, type Order, type OrderReport } from "./reconcile.ts";
import type { PaymentTransfer } from "./types.ts";

export interface Ledger {
  createOrder(order: Order): Promise<void>;
  listOrders(orderId?: string): Promise<Order[]>;
  listTransfers(reference?: string): Promise<PaymentTransfer[]>;
}

export interface ApiOptions {
  merchant: string;
  mint: string;
  decimals: number;
  newReference?: () => string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 16 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new HttpError(413, "body too large");
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "body must be a JSON object");
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

export function createApi(ledger: Ledger, options: ApiOptions): Server {
  const newReference = options.newReference ?? (() => Keypair.generate().publicKey.toBase58());
  const display = (units: bigint) => fromBaseUnits(units, options.decimals);
  const report = (r: OrderReport) => ({
    ...r,
    expectedDisplay: display(r.expected),
    receivedDisplay: display(r.received),
  });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const orderMatch = /^\/orders\/([^/]+)$/.exec(url.pathname);

    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/orders") {
      const body = await readJson(req);
      const { orderId, amount, label } = body;
      if (typeof orderId !== "string" || !/^[\w.-]{1,64}$/.test(orderId)) {
        throw new HttpError(400, "orderId must be 1-64 letters, digits, '_', '-' or '.'");
      }
      if (typeof amount !== "string") throw new HttpError(400, "amount must be a decimal string, e.g. \"1.50\"");
      if (label !== undefined && typeof label !== "string") throw new HttpError(400, "label must be a string");
      let expected: bigint;
      try {
        expected = toBaseUnits(amount, options.decimals);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      if (expected === 0n) throw new HttpError(400, "amount must be greater than zero");
      const order: Order = { orderId, reference: newReference(), expected, label: label ?? null };
      try {
        await ledger.createOrder(order);
      } catch (error) {
        if ((error as Error).name === "OrderExistsError" || /already exists/.test((error as Error).message)) {
          throw new HttpError(409, `order ${orderId} already exists`);
        }
        throw error;
      }
      return send(res, 201, {
        ...order,
        expectedDisplay: amount,
        url: solanaPayUrl(options.merchant, amount, options.mint, order.reference, order.label ?? undefined),
      });
    }

    if (req.method === "GET" && orderMatch) {
      const [order] = await ledger.listOrders(decodeURIComponent(orderMatch[1]!));
      if (!order) throw new HttpError(404, "order not found");
      const [r] = reconcile([order], await ledger.listTransfers(order.reference)).orders;
      return send(res, 200, report(r!));
    }

    if (req.method === "GET" && url.pathname === "/reconciliation") {
      const result = reconcile(await ledger.listOrders(), await ledger.listTransfers());
      const status = url.searchParams.get("status");
      const orders = result.orders.filter((o) => !status || o.status === status).map(report);
      return send(res, 200, { orders, unmatched: result.unmatched });
    }

    throw new HttpError(404, "not found");
  }

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      console.error(error);
      send(res, 500, { error: "internal error" });
    });
  });
}
