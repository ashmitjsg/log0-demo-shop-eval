// Traffic for the demo shop. One script, one scenario at a time:
//
//   k6 run -e SCENARIO=baseline shop.js
//   k6 run -e SCENARIO=trending -e VUS=60 -e DURATION=30s shop.js
//
// "baseline" is ordinary shopping and should produce no errors. Every other scenario is the traffic that
// makes one planted bug show itself (see ../bugs.yml for which bug each one is for).
//
// Env: STORE (default http://localhost:8090), PAYMENTS (default http://localhost:8092), VUS, DURATION.

import http from "k6/http";
import { check, sleep } from "k6";

const STORE = __ENV.STORE || "http://localhost:8090";
const PAYMENTS = __ENV.PAYMENTS || "http://localhost:8092";
const SCENARIO = __ENV.SCENARIO || "baseline";
const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

let counter = 0;
const cartId = () => `k6-${__VU}-${__ITER}-${Date.now()}-${counter++}`;
const post = (url, body) => http.post(url, JSON.stringify(body), JSON_HEADERS);

function addToCart(id, sku, qty) {
  return post(`${STORE}/cart/${id}/items`, { sku, qty });
}

function checkout(sku, qty) {
  const id = cartId();
  addToCart(id, sku, qty);
  return post(`${STORE}/checkout`, { cartId: id });
}

function chaos(body) {
  return post(`${PAYMENTS}/_chaos`, body);
}

const scenarios = {
  // ordinary shopping: browse, fill a cart, check out cheap in-stock items
  baseline() {
    const products = http.get(`${STORE}/products?limit=10`);
    check(products, { "products ok": (r) => r.status === 200 });
    const res = checkout("SKU-1003", 1);
    check(res, { "checkout ok": (r) => r.status === 201 });
    sleep(0.2);
  },

  // B1: the "trending" widget on the home page, hit by many visitors at once
  trending() {
    check(http.get(`${STORE}/products/trending`), { "trending ok": (r) => r.status === 200 });
  },

  // B2: the mobile app sends SKUs in lower case
  legacySku() {
    const id = cartId();
    addToCart(id, "sku-1004", 1);
    check(http.get(`${STORE}/cart/${id}`), { "cart ok": (r) => r.status === 200 });
  },

  // B3: someone orders more than is in stock (3 left)
  oversell() {
    const res = checkout("SKU-1038", 4);
    check(res, { "refused cleanly": (r) => r.status === 409 });
  },

  // B4: a big order (at least $100), which the payments service protects against double charging
  bigOrder() {
    const res = checkout("SKU-1003", 14);
    check(res, { "checkout ok": (r) => r.status === 201 });
  },

  // B5: the payment provider has an outage
  gatewayOutage() {
    chaos({ mode: "unavailable" });
    for (let i = 0; i < 5; i++) checkout("SKU-1003", 1);
    chaos({ mode: "ok" });
  },

  // B6: the payment provider rotates our key and ours is out of date
  keyRotation() {
    chaos({ rotateKey: true });
    for (let i = 0; i < 5; i++) checkout("SKU-1003", 1);
  },

  // B7: a product that was added to the catalog but never stocked
  newProduct() {
    const res = checkout("SKU-1039", 1);
    check(res, { "refused cleanly": (r) => r.status === 409 });
  },

  // B8: a burst of checkouts at the same moment (a flash sale)
  burst() {
    const res = checkout("SKU-1005", 1);
    check(res, { "checkout ok": (r) => r.status === 201 });
  },
};

const NAMES = { baseline: "baseline", trending: "trending", "legacy-sku": "legacySku", oversell: "oversell", "big-order": "bigOrder", "gateway-outage": "gatewayOutage", "key-rotation": "keyRotation", "new-product": "newProduct", burst: "burst" };

const defaults = {
  baseline: { vus: 3, duration: "20s" },
  trending: { vus: 60, duration: "30s" },
  "legacy-sku": { vus: 2, duration: "10s" },
  oversell: { vus: 2, duration: "10s" },
  "big-order": { vus: 3, duration: "15s" },
  "gateway-outage": { vus: 1, duration: "10s" },
  "key-rotation": { vus: 1, duration: "5s" },
  "new-product": { vus: 2, duration: "10s" },
  burst: { vus: 60, duration: "20s" },
};

if (!NAMES[SCENARIO]) throw new Error(`unknown SCENARIO ${SCENARIO}; choose one of ${Object.keys(NAMES).join(", ")}`);

export const options = {
  vus: Number(__ENV.VUS) || defaults[SCENARIO].vus,
  duration: __ENV.DURATION || defaults[SCENARIO].duration,
  // a planted bug makes requests fail on purpose: do not let k6 treat that as a failed run
  thresholds: {},
};

export default function () {
  scenarios[NAMES[SCENARIO]]();
}
