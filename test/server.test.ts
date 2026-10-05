// The move to a server: the Firestore copy round-trips exactly (order included), the cutover merge keeps each side's
// people, and the test-only endpoints refuse anything that came through a proxy or tunnel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, type Db, type Idea, type User } from "../src/store.js";
import { Mirror } from "../src/mirror.js";
import { merge } from "../src/merge.js";
import { startServer } from "../src/server.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "slopstop-")), "db.json");
const user = (id: string): User => ({ id, facts: [], pending: [], joined: "2026-10-04T00:00:00.000Z" });
const idea = (id: string, owner: string, created: string): Idea => ({
  id, owner, created, text: id, title: id, gist: id, trunk: "t", branch: "b", problem: 7, fix: 2, score: 60, verdict: "", move: "", private: false,
});

/** Just enough of Firestore's REST API: list a collection, get one doc, commit writes. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  let commits = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\//, ""));
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (init?.method === "POST" && path.endsWith(":commit")) {
      commits++;
      for (const w of JSON.parse(String(init.body)).writes) {
        if (w.update) docs.set(w.update.name, w.update.fields);
        else docs.delete(w.delete);
      }
      return ok({});
    }
    if (docs.has(path)) return ok({ name: path, fields: docs.get(path) });
    const kids = [...docs].filter(([name]) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/"));
    if (/\/(users|ideas|intros|messages)$/.test(path)) return ok({ documents: kids.map(([name, fields]) => ({ name, fields })) });
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
  }) as typeof fetch;
  return { docs, commits: () => commits, restore: () => void (globalThis.fetch = real) };
}

test("Firestore copy: a server's data goes up, deletes follow, and a fresh server restores it in order", async () => {
  process.env.FIRESTORE_TOKEN = "test";
  const fs = fakeFirestore();
  try {
    const a = new JsonStore(tmp());
    a.saveUser(user("+16075550101"));
    a.saveUser(user("+16075550102"));
    // Out of date order on purpose: the list order, not the timestamps, is what comes back.
    a.addIdea(idea("zeta", "+16075550101", "2026-10-04T03:00:00.000Z"));
    a.addIdea(idea("alpha", "+16075550102", "2026-10-04T01:00:00.000Z"));
    a.addIdea(idea("mid", "+16075550101", "2026-10-04T02:00:00.000Z"));
    a.addIntro({ id: "x1", a: "+16075550101", b: "+16075550102", ideaA: "zeta", ideaB: "alpha", status: "offered", created: "2026-10-04T04:00:00.000Z" });

    const up = new Mirror(a, "p");
    await up.boot();
    assert.equal([...fs.docs.keys()].filter((k) => k.includes("/ideas/")).length, 3);
    assert.ok(fs.docs.has("projects/p/databases/(default)/documents/users/+16075550101"));

    // A change syncs on its own; a removal deletes the doc.
    a.removeIdea("mid");
    await up.settle();
    assert.equal([...fs.docs.keys()].filter((k) => k.includes("/ideas/")).length, 2);
    const before = fs.commits();
    up.kick();
    await up.settle();
    assert.equal(fs.commits(), before, "nothing changed, nothing written");

    // A new machine with an empty disk.
    const b = new JsonStore(tmp());
    assert.equal(b.exists(), false);
    await new Mirror(b, "p").boot();
    assert.deepEqual(b.dump().ideas.map((i) => i.id), ["zeta", "alpha"]);
    assert.deepEqual(Object.keys(b.dump().users).sort(), ["+16075550101", "+16075550102"]);
    assert.equal(b.dump().intros.length, 1);
    assert.deepEqual(b.dump(), JSON.parse(JSON.stringify(a.dump())));
  } finally {
    fs.restore();
    delete process.env.FIRESTORE_TOKEN;
  }
});

test("cutover merge: the laptop wins for everyone except the test numbers, whose records come from the server", () => {
  const me = "+16075550199";
  const laptop: Db = {
    users: { [me]: user(me), "+1607555020": user("+1607555020"), "+1607555021": { ...user("+1607555021"), name: "New" } },
    ideas: [idea("old-mine", me, "1"), idea("theirs", "+1607555020", "2"), idea("late-theirs", "+1607555021", "3")],
    intros: [],
    messages: [
      { id: "m1", who: me, dir: "in", text: "laptop copy of a test number", at: "2026-10-04T01:00:00.000Z" },
      { id: "m2", who: "+1607555020", dir: "in", text: "real person", at: "2026-10-04T02:00:00.000Z" },
    ],
  };
  const server: Db = {
    users: { [me]: { ...user(me), name: "Dylan" }, "+1607555020": user("+1607555020") },
    ideas: [idea("old-mine", me, "1"), idea("theirs", "+1607555020", "2"), idea("test-mine", me, "4")],
    intros: [{ id: "i1", a: me, b: "+1607555020", ideaA: "test-mine", ideaB: "theirs", status: "declined", created: "5" }],
    messages: [{ id: "m0", who: me, dir: "in", text: "server copy of a test number", at: "2026-10-04T00:30:00.000Z" }],
  };
  // Read back from the server's log: one new bubble, and the same text the laptop also heard (kept once).
  const extra = [
    { id: "m3", who: me, dir: "out" as const, text: "here's your deck.", at: "2026-10-04T03:00:00.000Z" },
    { id: "m4", who: me, dir: "in" as const, text: "laptop copy of a test number", at: "2026-10-04T01:00:04.000Z" },
  ];
  const out = merge(laptop, server, new Set([me]), extra);
  assert.deepEqual(out.ideas.map((i) => i.id), ["theirs", "late-theirs", "old-mine", "test-mine"]);
  assert.equal(out.users[me].name, "Dylan");
  assert.deepEqual(out.messages.map((m) => m.id), ["m0", "m1", "m2", "m3"]);
  assert.equal(out.users["+1607555021"].name, "New");
  assert.equal(out.intros.length, 1);
});

test("test-only endpoints refuse anything forwarded by a proxy or tunnel, and health answers", async () => {
  const store = new JsonStore(tmp());
  const web = startServer({ store, port: 0, play: async () => [], status: () => ({ version: "abc" }) });
  await web.ready;
  try {
    const port = web.port();
    const post = (headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}/api/dev/text`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ from: "x", text: "hi" }) });
    assert.equal((await post({})).status, 200);
    assert.equal((await post({ "x-forwarded-for": "1.2.3.4" })).status, 404);
    assert.equal((await post({ "cf-connecting-ip": "1.2.3.4" })).status, 404);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.deepEqual(health, { ok: true, version: "abc" });
  } finally {
    web.close();
  }
});
