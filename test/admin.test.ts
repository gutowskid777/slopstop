// /admin: off without a passcode, locked without the token, never shows a whole phone number, and hide/delete
// take an idea off the public tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, msgId, type Idea } from "../src/store.js";
import { startServer } from "../src/server.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "slopstop-admin-")), "db.json");
const idea = (id: string, owner: string, score: number, extra: Partial<Idea> = {}): Idea => ({
  id, owner, created: `2026-10-04T0${score % 10}:00:00.000Z`, text: id, title: `title ${id}`, gist: id, trunk: "t", branch: "b",
  problem: 8, fix: 2, score, verdict: "", move: "", private: false, ...extra,
});

async function serve(store: JsonStore) {
  const web = startServer({ store, port: 0 });
  await web.ready;
  const base = `http://127.0.0.1:${web.port()}`;
  const call = (path: string, init: RequestInit & { token?: string } = {}) =>
    fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) } });
  return { web, call };
}

test("admin is off without a passcode", async () => {
  delete process.env.ADMIN_PASSCODE;
  const { web, call } = await serve(new JsonStore(tmp()));
  try {
    assert.equal((await call("/admin")).status, 404);
    assert.equal((await call("/api/admin/login", { method: "POST", body: JSON.stringify({ passcode: "" }) })).status, 404);
  } finally {
    web.close();
  }
});

test("admin: passcode gate, masked numbers, stats, hide and delete", async () => {
  process.env.ADMIN_PASSCODE = "correct-horse-1";
  const store = new JsonStore(tmp());
  const a = "+16075551234";
  const b = "+19175559876";
  store.saveUser({ id: a, facts: [], pending: [], joined: "2026-10-04T00:00:00.000Z", name: "Ana" });
  store.addIdea(idea("good", a, 82));
  store.addIdea(idea("joke", b, 12));
  store.addIdea(idea("seed", "sample-owner", 50, { sample: true }));
  store.addIntro({ id: "x", a, b, ideaA: "good", ideaB: "joke", status: "connected", created: "2026-10-04T05:00:00.000Z" });
  const now = new Date().toISOString();
  store.addMessage({ id: msgId(), who: a, dir: "in", text: "my idea: a thing", at: now });
  store.addMessage({ id: msgId(), who: a, dir: "out", text: "[deck] Thing pitch deck.pdf", at: now });
  store.addMessage({ id: msgId(), who: b, dir: "in", text: "lol", at: "2026-10-04T01:00:00.000Z" });
  const { web, call } = await serve(store);
  try {
    assert.equal((await call("/admin")).status, 200);
    assert.equal((await call("/api/admin/data")).status, 401);
    assert.equal((await call("/api/admin/data", { token: "nope" })).status, 401);
    assert.equal((await call("/api/admin/login", { method: "POST", body: JSON.stringify({ passcode: "wrong" }) })).status, 401);
    const { token } = await (await call("/api/admin/login", { method: "POST", body: JSON.stringify({ passcode: "correct-horse-1" }) })).json();
    assert.ok(token);

    const res = await call("/api/admin/data", { token });
    const raw = await res.text();
    assert.ok(!raw.includes("6075551234") && !raw.includes("9175559876"), "a whole number leaked");
    const data = JSON.parse(raw);
    assert.equal(data.stats.ideas, 2);
    assert.equal(data.stats.texted, 2);
    assert.equal(data.stats.average, 47);
    assert.equal(data.stats.seventyPlus, 1);
    assert.equal(data.stats.introsAccepted, 1);
    assert.equal(data.stats.decksToday, 1);
    assert.deepEqual(data.ideas.map((i: { who: string }) => i.who).sort(), ["•••1234", "•••9876"]);
    assert.equal(data.people[0].who, "•••1234", "most recent conversation first");
    assert.equal(data.people[0].name, "Ana");
    assert.equal(data.people[0].messages.length, 2);

    const act = (id: string, action: string) => call("/api/admin/idea", { method: "POST", token, body: JSON.stringify({ id, action }) });
    assert.equal((await act("joke", "hide")).status, 200);
    let map = await (await call("/api/map")).json();
    assert.ok(!JSON.stringify(map).includes("title joke"));
    assert.equal(store.idea("joke")?.hidden, true);
    assert.equal((await act("joke", "show")).status, 200);
    map = await (await call("/api/map")).json();
    assert.ok(JSON.stringify(map).includes("title joke"));
    assert.equal((await act("joke", "delete")).status, 200);
    assert.equal(store.idea("joke"), undefined);
    assert.equal((await act("seed", "delete")).status, 404, "samples are not admin's to touch");
  } finally {
    web.close();
    delete process.env.ADMIN_PASSCODE;
  }
});

test("forget wipes a person's messages too", () => {
  const store = new JsonStore(tmp());
  store.addMessage({ id: msgId(), who: "+16075551234", dir: "in", text: "hi", at: new Date().toISOString() });
  store.addMessage({ id: msgId(), who: "+16075550000", dir: "in", text: "hey", at: new Date().toISOString() });
  store.forget("+16075551234");
  assert.deepEqual(store.messages().map((m) => m.who), ["+16075550000"]);
});
