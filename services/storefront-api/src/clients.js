// Calls to the other services: inventory (Rust) and payments (Go).

const INVENTORY_URL = process.env.INVENTORY_URL || "http://localhost:8091";
const PAYMENTS_URL = process.env.PAYMENTS_URL || "http://localhost:8092";
const INVENTORY_TIMEOUT_MS = 2000;
const PAYMENTS_TIMEOUT_MS = 5000;

async function postJson(url, body, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

export class OutOfStockError extends Error {
  constructor(sku) {
    super(`not enough stock for ${sku}`);
    this.name = "OutOfStockError";
    this.sku = sku;
  }
}

/** Reserve stock for an order. Rejects with OutOfStockError when inventory says there is not enough. */
export async function reserveStock(orderId, lines) {
  const { status, data } = await postJson(`${INVENTORY_URL}/reserve`, { orderId, lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) }, INVENTORY_TIMEOUT_MS);
  if (status === 409) throw new OutOfStockError(data.sku ?? "unknown");
  if (status !== 200) throw new Error(`inventory answered ${status}`);
  return data;
}

export async function releaseStock(orderId) {
  return postJson(`${INVENTORY_URL}/release`, { orderId }, INVENTORY_TIMEOUT_MS);
}

/** Charge the customer. The idempotency key makes a repeated checkout safe. */
export async function charge(orderId, amountCents, idempotencyKey) {
  const { status, data } = await postJson(`${PAYMENTS_URL}/charge`, { orderId, amountCents, idempotencyKey }, PAYMENTS_TIMEOUT_MS);
  return { ok: status === 200, status, data };
}
