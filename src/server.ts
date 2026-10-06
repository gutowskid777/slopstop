// The web side: the branch map, the pitch graph, and the "text it" join step. One small HTTP server, no framework.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, normalize } from "node:path";
import QRCode from "qrcode";
import { adminApi, adminOn, recount, SPOTS, spotsLeft } from "./admin.js";
import { meApi, type SendCode } from "./signin.js";
import { mapPayload } from "./map.js";
import { addUser, e164, online as photonOnline, textLink } from "./photon.js";
import type { Out } from "./core.js";
import type { JsonStore } from "./store.js";

const PUBLIC = resolve(process.cwd(), "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const PAGES: Record<string, string> = { "/": "index.html", "/graph": "graph.html", "/me": "me.html" };
/** What Messages opens with. They finish the sentence, so their first text is already the idea. */
const OPENER = "my idea: ";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const body = async (req: IncomingMessage) => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("too big");
  }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
};

export type Line = { to: string; out: Out[] };

export function startServer(opts: {
  store: JsonStore;
  port: number;
  /** Play a builder from the terminal against the live process. This machine only. */
  play?: (from: string, text: string) => Promise<Line[]>;
  /** Have the agent text a real number first. This machine only. */
  ping?: (to: string, text: string) => Promise<void>;
  /** Text a sign-in code to a number on the line. Off when the agent is off. */
  sendCode?: SendCode;
  /** What /api/health reports: the version, whether the line is up, whether the hosted copy is current. */
  status?: () => Record<string, unknown>;
}) {
  const { store } = opts;
  const watchers = new Set<ServerResponse>();
  let joins: number[] = [];

  /** Push the map to every open page. */
  const broadcast = () => {
    const data = `data: ${JSON.stringify(mapPayload(store))}\n\n`;
    for (const w of watchers) w.write(data);
  };

  // The terminal harness and the seeder write the same file from another process. Pick that up too.
  setInterval(() => store.reload() && broadcast(), 1000).unref();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/api/map") return json(res, 200, mapPayload(store));

      if (path === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify(mapPayload(store))}\n\n`);
        watchers.add(res);
        const beat = setInterval(() => res.write(": beat\n\n"), 20_000);
        req.on("close", () => {
          clearInterval(beat);
          watchers.delete(res);
        });
        return;
      }

      if (await adminApi(req, res, path, store, () => body(req), broadcast)) return;
      if (await meApi(req, res, path, store, () => body(req), opts.sendCode)) return;
      // The admin shell only exists while a passcode is set. Its data still needs the passcode.
      if (path === "/admin" || path === "/admin.html") {
        if (!adminOn()) return json(res, 404, { error: "Not found" });
        const page = await readFile(resolve(PUBLIC, "admin.html"));
        res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store", "x-robots-tag": "noindex", "x-frame-options": "SAMEORIGIN" });
        return res.end(page);
      }

      if (path === "/api/spots") return json(res, 200, { left: await spotsLeft(), cap: SPOTS });

      if (path === "/api/health") return json(res, 200, { ok: true, ...opts.status?.() });

      if (path.startsWith("/api/dev/") && req.method === "POST") {
        // This machine only. A proxy or tunnel also connects from 127.0.0.1, so a forwarded request is never local.
        const forwarded = Boolean(req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || req.headers["x-real-ip"]);
        const local = !forwarded && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
        if (!local) return json(res, 404, { error: "Not found" });
        const b = await body(req);
        if (path === "/api/dev/text" && opts.play) return json(res, 200, { lines: await opts.play(String(b.from ?? "you"), String(b.text ?? "")) });
        if (path === "/api/dev/ping" && opts.ping) {
          await opts.ping(String(b.to ?? ""), String(b.text ?? ""));
          return json(res, 200, { sent: true });
        }
        return json(res, 404, { error: "Not found" });
      }

      // "Text it": register the number with the line, hand back a link that opens Messages already addressed.
      if (path === "/api/join" && req.method === "POST") {
        if (!photonOnline()) return json(res, 503, { error: "The text line isn't connected on this machine yet." });
        const phone = e164(String((await body(req)).phone ?? ""));
        if (!phone) return json(res, 400, { error: "That doesn't look like a phone number. Try all 10 digits." });
        const hour = Date.now() - 3600_000;
        joins = joins.filter((t) => t > hour);
        if (joins.length >= 60) return json(res, 429, { error: "Lots of people joining right now. Try again in a few minutes." });
        joins.push(Date.now());
        const user = await addUser(phone);
        recount();
        const link = textLink(user.id, OPENER);
        return json(res, 200, {
          link,
          number: user.assignedPhoneNumber,
          sms: `sms:${user.assignedPhoneNumber}&body=${encodeURIComponent(OPENER)}`,
          qr: await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#14261b", light: "#0000" } }),
          // Someone who already has ideas gets a way to see them. Only a yes or no: what they are needs the texted code.
          returning: store.ideasBy(phone).some((i) => !i.sample),
        });
      }

      const file = PAGES[path] ?? normalize(path).replace(/^([/\\]|\.\.)+/, "");
      const full = resolve(PUBLIC, file);
      if (!full.startsWith(PUBLIC)) return json(res, 404, { error: "Not found" });
      const data = await readFile(full).catch(() => undefined);
      if (!data) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": TYPES[extname(full)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch (err) {
      console.error(err);
      json(res, 500, { error: String((err as Error)?.message ?? "Something broke. Try again.") });
    }
  });
  // Two copies would both answer every text. Refuse to be the second one.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `already running on port ${opts.port}. stop it first: npm run stop` : err);
    process.exit(1);
  });
  // HOST=127.0.0.1 on the server: only the web proxy in front of it can reach the port.
  server.listen(opts.port, process.env.HOST, () => console.log(`map on http://localhost:${opts.port}   graph on http://localhost:${opts.port}/graph`));
  /** Resolves once the port is ours. */
  const ready = new Promise<void>((done) => server.once("listening", () => done()));
  return { broadcast, ready, close: () => server.close(), port: () => (server.address() as { port: number }).port };
}
