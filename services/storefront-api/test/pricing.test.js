import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvent } from "../src/log0.js";
import { normalizeSku, priceCart } from "../src/pricing.js";

const catalog = [
  { sku: "SKU-1001", priceCents: 500 },
  { sku: "SKU-1002", priceCents: 625 },
];

test("prices each line and the total", () => {
  const priced = priceCart([{ sku: "SKU-1001", qty: 2 }, { sku: "SKU-1002", qty: 1 }], catalog);
  assert.equal(priced.totalCents, 1625);
  assert.deepEqual(priced.lines.map((l) => l.totalCents), [1000, 625]);
});

test("a sku typed in lower case or with spaces is the same product", () => {
  assert.equal(normalizeSku(" sku-1001 "), "SKU-1001");
  assert.equal(priceCart([{ sku: "sku-1001", qty: 1 }], catalog).totalCents, 500);
});

test("an unknown sku is a clear error, not a crash", () => {
  assert.throws(() => priceCart([{ sku: "NOPE", qty: 1 }], catalog), /unknown sku NOPE/);
});

test("an empty cart is refused", () => {
  assert.throws(() => priceCart([], catalog), /cart is empty/);
});

test("log events carry the fields log0 expects, and the stack as the trace", () => {
  const plain = buildEvent("ERROR", "boom");
  assert.deepEqual(Object.keys(plain).sort(), ["level", "message", "timestamp"]);
  assert.ok(!Number.isNaN(Date.parse(plain.timestamp)));
  const withTrace = buildEvent("ERROR", "boom", new Error("inner"));
  assert.match(withTrace.trace, /Error: inner\n\s+at /);
});
