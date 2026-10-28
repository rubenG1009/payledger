import type { PaymentTransfer } from "./types.ts";

export type OrderStatus = "pending" | "paid" | "underpaid" | "overpaid";

export interface Order {
  orderId: string;
  reference: string;
  expected: bigint; // base units
  label: string | null;
}

export interface OrderReport {
  orderId: string;
  reference: string;
  label: string | null;
  expected: bigint;
  received: bigint;
  status: OrderStatus;
  payments: PaymentTransfer[];
}

export interface Reconciliation {
  orders: OrderReport[];
  // Payments on a tracked reference that no order claims, e.g. a reference added with `add-reference`.
  unmatched: PaymentTransfer[];
}

export function orderStatus(expected: bigint, received: bigint): OrderStatus {
  if (received === 0n) return "pending";
  if (received < expected) return "underpaid";
  return received === expected ? "paid" : "overpaid";
}

export function reconcile(orders: Order[], transfers: PaymentTransfer[]): Reconciliation {
  const byReference = new Map<string, PaymentTransfer[]>();
  for (const t of transfers) byReference.set(t.reference, [...(byReference.get(t.reference) ?? []), t]);

  const reports = orders.map((order): OrderReport => {
    const payments = byReference.get(order.reference) ?? [];
    byReference.delete(order.reference);
    const received = payments.reduce((sum, p) => sum + p.amount, 0n);
    return { ...order, received, status: orderStatus(order.expected, received), payments };
  });
  return { orders: reports, unmatched: [...byReference.values()].flat() };
}

// Exact decimal → base-unit conversion ("1.5", 6 decimals → 1500000n); never goes through floats.
export function toBaseUnits(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) throw new Error(`invalid amount: ${amount}`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

export function fromBaseUnits(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
