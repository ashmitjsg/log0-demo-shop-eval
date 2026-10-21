// Ships log events to log0 (https://log0.in). The contract is plain HTTP, so any language can do it:
//   POST {LOG0_URL}/api/v1/logs
//   headers  X-API-KEY, X-SERVICE-NAME, X-ENVIRONMENT
//   body     {"timestamp": ISO-8601, "level": "ERROR", "message": "...", "trace": "stack trace, optional"}
// Events are also printed to stdout as JSON. Shipping never throws and never blocks a request.

const URL_BASE = process.env.LOG0_URL;
const API_KEY = process.env.LOG0_API_KEY;
const SERVICE = process.env.LOG0_SERVICE || "storefront-api";
const ENVIRONMENT = process.env.LOG0_ENV || "demo";

const ORDER = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
const MIN_LEVEL = ORDER.indexOf((process.env.LOG0_MIN_LEVEL || "WARN").toUpperCase());

export function buildEvent(level, message, err) {
  const event = {
    timestamp: new Date().toISOString(),
    level,
    message: String(message).slice(0, 9000),
  };
  if (err && err.stack) event.trace = String(err.stack).slice(0, 90000);
  return event;
}

function ship(event) {
  if (!URL_BASE || !API_KEY) return;
  if (ORDER.indexOf(event.level) < MIN_LEVEL) return;
  fetch(`${URL_BASE}/api/v1/logs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": API_KEY,
      "X-SERVICE-NAME": SERVICE,
      "X-ENVIRONMENT": ENVIRONMENT,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

export function log(level, message, err) {
  const event = buildEvent(level, message, err);
  console.log(JSON.stringify({ ...event, service: SERVICE }));
  ship(event);
}

export const info = (m) => log("INFO", m);
export const warn = (m, e) => log("WARN", m, e);
export const error = (m, e) => log("ERROR", m, e);
