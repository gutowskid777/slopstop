// /admin: one private page to see and steer SlopStop. Off unless ADMIN_PASSCODE is set. The page itself is a static
// shell; every number, idea and thread comes from /api/admin/*, which wants the token the passcode unlocks.
// Phone numbers never leave this file whole: the page sees the last 4 digits and an opaque key per person.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { imageBudget } from "./deck.js";
import { listUsers, online as photonOnline } from "./photon.js";
import type { Idea, JsonStore, Msg } from "./store.js";

const passcode = () => process.env.ADMIN_PASSCODE ?? "";
export const adminOn = () => passcode().length >= 8;

/** The token is derived from the passcode, so changing the passcode signs everyone out. */
const tokenFor = (code: string) => createHmac("sha256", code).update("slopstop-admin-v1").digest("hex");
const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};
const authed = (req: IncomingMessage) => {
  const h = req.headers.authorization ?? "";
  return adminOn() && h.startsWith("Bearer ") && same(h.slice(7), tokenFor(passcode()));
};

/** Last 4 only. An email keeps its first letter and domain. */
export const last4 = (handle: string) => (handle.includes("@") ? `${handle[0]}…@${handle.split("@")[1]}` : `•••${handle.slice(-4)}`);
/** A stable key per person that isn't their number. */
const keyOf = (handle: string) => createHmac("sha256", passcode()).update(handle).digest("hex").slice(0, 12);

const today = () => new Date().toISOString().slice(0, 10);

// Registered = numbers on the Photon line. One call a minute at most.
let registered: { n: number | null; at: number } = { n: null, at: 0 };
async function registeredCount() {
  if (!photonOnline()) return null;
  if (Date.now() - registered.at < 60_000) return registered.n;
  try {
    registered = { n: (await listUsers()).length, at: Date.now() };
  } catch {
    registered = { n: registered.n, at: Date.now() };
  }
  return registered.n;
}

/** Photon Pro registers 100 people. The home page shows what's left; null while the line is offline. */
export const SPOTS = 100;
export async function spotsLeft() {
  const n = await registeredCount();
  return n === null ? null : Math.max(0, SPOTS - n);
}
/** A join just registered someone: count again on the next ask instead of waiting out the minute. */
export const recount = () => void (registered.at = 0);

export async function adminData(store: JsonStore) {
  const ideas = store.dump().ideas.filter((i) => !i.sample);
  const msgs = store.messages();
  const intros = store.intros();
  const d = today();
  const sentToday = msgs.filter((m) => m.dir === "out" && m.at.startsWith(d));
  const texted = new Set([...msgs.filter((m) => m.dir === "in").map((m) => m.who), ...ideas.map((i) => i.owner)]);
  const scores = ideas.map((i) => i.score);

  // One thread per person, the most recent conversation first.
  const threads = new Map<string, Msg[]>();
  for (const m of msgs) threads.set(m.who, [...(threads.get(m.who) ?? []), m]);
  const people = [...threads]
    .map(([who, list]) => ({
      key: keyOf(who),
      who: last4(who),
      name: store.user(who).name ?? "",
      ideas: ideas.filter((i) => i.owner === who).length,
      last: list.at(-1)!.at,
      messages: list.map((m) => ({ dir: m.dir, text: m.text, at: m.at })),
    }))
    .sort((a, b) => b.last.localeCompare(a.last));

  const status = (i: Idea) => (i.hidden ? "hidden" : i.private ? "private" : "public");
  return {
    stats: {
      registered: await registeredCount(),
      texted: texted.size,
      ideas: ideas.length,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      seventyPlus: scores.filter((s) => s >= 70).length,
      introsOffered: intros.length,
      introsAccepted: intros.filter((x) => x.status === "connected").length,
      decksToday: sentToday.filter((m) => m.text.startsWith("[deck]")).length,
      photosToday: sentToday.filter((m) => m.text === "[photo]").length,
      images: imageBudget(),
    },
    ideas: ideas
      .map((i) => ({ id: i.id, title: i.title, gist: i.gist, score: i.score, problem: i.problem, fix: i.fix, status: status(i), at: i.created, who: last4(i.owner) }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    people,
  };
}

// Ten wrong passcodes in 15 minutes locks the door for everyone until the window passes.
let misses: number[] = [];

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(JSON.stringify(body));
};

/** True when the request was an /api/admin one and has been answered. */
export async function adminApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  store: JsonStore,
  read: () => Promise<Record<string, unknown>>,
  changed: () => void,
): Promise<boolean> {
  if (!path.startsWith("/api/admin/")) return false;
  if (!adminOn()) return send(res, 404, { error: "Not found" }), true;

  if (path === "/api/admin/login" && req.method === "POST") {
    const window = Date.now() - 15 * 60_000;
    misses = misses.filter((t) => t > window);
    if (misses.length >= 10) return send(res, 429, { error: "Too many tries. Wait 15 minutes." }), true;
    const code = String((await read()).passcode ?? "");
    if (!same(code, passcode())) {
      misses.push(Date.now());
      return send(res, 401, { error: "Wrong passcode." }), true;
    }
    return send(res, 200, { token: tokenFor(passcode()) }), true;
  }

  if (!authed(req)) return send(res, 401, { error: "Sign in again." }), true;

  if (path === "/api/admin/data" && req.method === "GET") return send(res, 200, await adminData(store)), true;

  if (path === "/api/admin/idea" && req.method === "POST") {
    const b = await read();
    const idea = store.idea(String(b.id ?? ""));
    if (!idea || idea.sample) return send(res, 404, { error: "That idea is gone." }), true;
    if (b.action === "hide" || b.action === "show") store.saveIdea({ ...idea, hidden: b.action === "hide" });
    else if (b.action === "delete") store.removeIdea(idea.id);
    else return send(res, 400, { error: "Unknown action." }), true;
    changed();
    return send(res, 200, { ok: true }), true;
  }

  return send(res, 404, { error: "Not found" }), true;
}
