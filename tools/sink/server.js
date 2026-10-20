// A stand-in for log0's ingestion gateway, for checking what the demo services ship without a log0 stack.
//   node server.js            listens on :8099
//   POST /api/v1/logs         records the event with its X-* headers (400 unless the contract is met)
//   GET  /events              everything recorded;   DELETE /events   forget it all
import { createServer } from "node:http";

const events = [];
const LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function validate(headers, body) {
  for (const h of ["x-api-key", "x-service-name", "x-environment"]) if (!headers[h]) return `missing header ${h}`;
  if (!body || typeof body !== "object") return "body must be a JSON object";
  if (Number.isNaN(Date.parse(body.timestamp))) return "timestamp must be ISO-8601";
  if (!LEVELS.has(body.level)) return "level must be DEBUG, INFO, WARN, ERROR or FATAL";
  if (typeof body.message !== "string" || !body.message) return "message is required";
  if (body.trace !== undefined && typeof body.trace !== "string") return "trace must be a string";
  return null;
}

export const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") return send(res, 200, events);
  if (req.method === "DELETE" && req.url === "/events") {
    events.length = 0;
    return send(res, 200, { cleared: true });
  }
  if (req.method === "POST" && req.url === "/api/v1/logs") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "invalid JSON" });
      }
      const problem = validate(req.headers, body);
      if (problem) return send(res, 400, { error: problem });
      events.push({ service: req.headers["x-service-name"], environment: req.headers["x-environment"], ...body });
      send(res, 202, {});
    });
    return;
  }
  send(res, 404, { error: "not found" });
});

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("server.js")) {
  server.listen(8099, () => console.log("sink listening on 8099"));
}
