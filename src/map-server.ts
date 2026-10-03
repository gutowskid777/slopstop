// Local map server: the page + a JSON endpoint it polls. On Vercel this becomes public/ + api/map.
import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonStore } from "./store.js";
import { mapPayload } from "./map.js";

const port = Number(process.env.PORT ?? 1290);
const page = resolve(process.cwd(), "public/index.html");

createServer((req, res) => {
  if (req.url?.startsWith("/api/map")) {
    const store = new JsonStore();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(mapPayload(store)));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(page));
}).listen(port, () => console.log(`map on http://localhost:${port}`));
