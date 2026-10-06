// /me: someone sees their own ideas on the web. A phone number alone proves nothing (anyone can type yours), so
// SlopStop texts a 6-digit code to that number over iMessage and only the phone that gets it can sign in.
// What the page shows is the ideas themselves: never a phone number, never the facts we kept about them.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { e164 } from "./photon.js";
import type { JsonStore } from "./store.js";

const CODE_MS = 10 * 60_000;
const SESSION_MS = 30 * 86_400_000;
const COOKIE = "ss_me";

// One random key per server, next to the data. A new server makes a new one, which only signs people out.
let key: Buffer | undefined;
function secret() {
  if (key) return key;
  const file = resolve(dirname(resolve(process.cwd(), process.env.DB_PATH ?? "data/db.json")), "session-secret");
  if (existsSync(file)) key = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  if (!key || key.length < 32) {
    key = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  }
  return key;
}

const hash = (s: string) => createHmac("sha256", secret()).update(s).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const sign = (s: string) => createHmac("sha256", secret()).update(`session:${s}`).digest("base64url");

type Pending = { code: Buffer; until: number; tries: number };
const codes = new Map<string, Pending>();
/** When codes went out, per number and for everyone, so nobody can use this to spam a stranger. */
const sentTo = new Map<string, number[]>();
let sentAll: number[] = [];

/** A known SlopStop person: someone who has texted it. Nobody else can get a code. */
const known = (store: JsonStore, handle: string) => Boolean(store.dump().users[handle]) || store.ideasBy(handle).length > 0;

export type SendCode = (to: string, text: string) => Promise<void>;

/** Ask for a code. The answer is the same whether or not the number is on SlopStop, so this can't be used to check. */
export async function requestCode(store: JsonStore, raw: string, send?: SendCode): Promise<{ status: number; body: object }> {
  const handle = e164(raw);
  if (!handle) return { status: 400, body: { error: "That doesn't look like a phone number. Try all 10 digits." } };
  const now = Date.now();
  const mine = (sentTo.get(handle) ?? []).filter((t) => t > now - 15 * 60_000);
  sentAll = sentAll.filter((t) => t > now - 3_600_000);
  if (mine.length >= 3 || sentAll.length >= 60) return { status: 429, body: { error: "Too many codes. Try again in a few minutes." } };
  const ok = { status: 200, body: { sent: true } };
  if (!send || !known(store, handle)) return ok;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  codes.set(handle, { code: hash(`${handle}:${code}`), until: now + CODE_MS, tries: 0 });
  sentTo.set(handle, [...mine, now]);
  sentAll.push(now);
  await send(handle, `your slopstop sign-in code: ${code}\nit works for 10 min. didn't ask for it? ignore this.`).catch((err) =>
    console.error(`sign-in code not sent: ${String((err as Error)?.message ?? err).slice(0, 160)}`),
  );
  return ok;
}

/** Check a code. Right = a signed cookie for 30 days. Five wrong tries and that code is gone. */
export function verifyCode(raw: string, code: string): { handle?: string; error?: string } {
  const handle = e164(raw);
  const p = handle ? codes.get(handle) : undefined;
  if (!handle || !p || p.until < Date.now()) return { error: "That code expired. Get a new one." };
  if (!same(p.code, hash(`${handle}:${code.replace(/\D/g, "")}`))) {
    if (++p.tries >= 5) codes.delete(handle);
    return { error: p.tries >= 5 ? "Too many wrong tries. Get a new code." : "That's not the code." };
  }
  codes.delete(handle);
  return { handle };
}

/** The cookie: who and until when, signed. */
export function sessionCookie(handle: string, secure: boolean) {
  const payload = Buffer.from(JSON.stringify({ h: handle, u: Date.now() + SESSION_MS })).toString("base64url");
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
}
export const signOutCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

/** Whose session this request carries, if any. */
export function whoIs(req: IncomingMessage): string | undefined {
  const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [payload, mac] = (raw ?? "").split(".");
  if (!payload || !mac || !same(Buffer.from(mac), Buffer.from(sign(payload)))) return undefined;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as { h: string; u: number };
    return s.u > Date.now() ? s.h : undefined;
  } catch {
    return undefined;
  }
}

/** Their ideas, newest first, with nothing on them that says who they are. */
export function myIdeas(store: JsonStore, handle: string) {
  return store
    .ideasBy(handle)
    .filter((i) => !i.sample)
    .map((i) => ({ title: i.title, gist: i.gist, score: i.score, problem: i.problem, fix: i.fix, verdict: i.verdict, move: i.move, private: i.private, hidden: Boolean(i.hidden), at: i.created }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** HTTPS behind the proxy, so the cookie gets Secure. */
export const isSecure = (req: IncomingMessage) => req.headers["x-forwarded-proto"] === "https" || /https/.test(String(req.headers["cf-visitor"] ?? ""));

/** True when the request was a /api/me one and has been answered. */
export async function meApi(req: IncomingMessage, res: ServerResponse, path: string, store: JsonStore, read: () => Promise<Record<string, unknown>>, send?: SendCode) {
  if (!path.startsWith("/api/me")) return false;
  const reply = (status: number, body: unknown, cookie?: string) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) });
    res.end(JSON.stringify(body));
    return true;
  };
  if (path === "/api/me/code" && req.method === "POST") {
    const r = await requestCode(store, String((await read()).phone ?? ""), send);
    return reply(r.status, r.body);
  }
  if (path === "/api/me/verify" && req.method === "POST") {
    const b = await read();
    const r = verifyCode(String(b.phone ?? ""), String(b.code ?? ""));
    return r.handle ? reply(200, { ok: true }, sessionCookie(r.handle, isSecure(req))) : reply(401, { error: r.error });
  }
  if (path === "/api/me/out" && req.method === "POST") return reply(200, { ok: true }, signOutCookie(isSecure(req)));
  if (path === "/api/me" && req.method === "GET") {
    const who = whoIs(req);
    return who ? reply(200, { ideas: myIdeas(store, who) }) : reply(401, { error: "Sign in first." });
  }
  return reply(404, { error: "Not found" });
}
