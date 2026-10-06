// /me: a code goes only to a number that uses SlopStop, the answer looks the same either way, a wrong code is
// refused (five strikes), and the signed-in page shows that person's ideas and nothing that names them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, type Idea } from "../src/store.js";
import { startServer } from "../src/server.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "slopstop-me-")), "db.json");
const idea = (id: string, owner: string, score: number, extra: Partial<Idea> = {}): Idea => ({
  id, owner, created: "2026-10-04T01:00:00.000Z", text: id, title: `title ${id}`, gist: id, trunk: "t", branch: "b",
  problem: 8, fix: 2, score, verdict: "real pain", move: "ask 10 ppl", private: false, ...extra,
});

test("sign in with a texted code, see only your own ideas, no phone number anywhere", async () => {
  const db = tmp();
  process.env.DB_PATH = db;
  const store = new JsonStore(db);
  const me = "+16075551234";
  store.saveUser({ id: me, facts: ["cornell sophomore"], pending: [], joined: "2026-10-04T00:00:00.000Z" });
  store.addIdea(idea("mine", me, 82));
  store.addIdea(idea("secret", me, 40, { private: true }));
  store.addIdea(idea("theirs", "+19175559876", 60));
  const sent: { to: string; text: string }[] = [];
  const web = startServer({ store, port: 0, sendCode: async (to, text) => void sent.push({ to, text }) });
  await web.ready;
  const base = `http://127.0.0.1:${web.port()}`;
  const post = (path: string, body: object, cookie?: string) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/api/me`)).status, 401);
    assert.equal((await fetch(`${base}/me`)).status, 200);

    // A stranger's number gets the same answer and no text.
    const stranger = await post("/api/me/code", { phone: "212 555 0000" });
    assert.equal(stranger.status, 200);
    assert.deepEqual(await stranger.json(), { sent: true });
    assert.equal(sent.length, 0);
    assert.equal((await post("/api/me/code", { phone: "12" })).status, 400);

    assert.equal((await post("/api/me/code", { phone: "(607) 555-1234" })).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, me);
    const code = sent[0].text.match(/\b(\d{6})\b/)![1];

    const wrong = code === "000000" ? "111111" : "000000";
    assert.equal((await post("/api/me/verify", { phone: "6075551234", code: wrong })).status, 401);
    const ok = await post("/api/me/verify", { phone: "6075551234", code });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    assert.match(ok.headers.get("set-cookie")!, /HttpOnly/);
    // A used code is spent.
    assert.equal((await post("/api/me/verify", { phone: "6075551234", code })).status, 401);

    const res = await fetch(`${base}/api/me`, { headers: { cookie } });
    const raw = await res.text();
    assert.ok(!raw.includes("5551234") && !raw.includes("9175559876") && !raw.includes("cornell"), "personal info leaked");
    const { ideas } = JSON.parse(raw);
    assert.deepEqual(ideas.map((i: { title: string }) => i.title).sort(), ["title mine", "title secret"]);

    // A forged cookie is nobody.
    const [v, mac] = cookie.split("=")[1].split(".");
    const forged = Buffer.from(JSON.stringify({ h: "+19175559876", u: Date.now() + 1e9 })).toString("base64url");
    assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: `ss_me=${forged}.${mac}` } })).status, 401);
    assert.ok(v);

    const out = await post("/api/me/out", {}, cookie);
    assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
  } finally {
    web.close();
    delete process.env.DB_PATH;
  }
});

test("five wrong codes kill the code; three codes per number per 15 minutes", async () => {
  const db = tmp();
  process.env.DB_PATH = db;
  const store = new JsonStore(db);
  const me = "+16075550777";
  store.addIdea(idea("x", me, 50));
  const sent: string[] = [];
  const web = startServer({ store, port: 0, sendCode: async (_to, text) => void sent.push(text) });
  await web.ready;
  const base = `http://127.0.0.1:${web.port()}`;
  const post = (path: string, body: object) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    await post("/api/me/code", { phone: me });
    const code = sent[0].match(/\b(\d{6})\b/)![1];
    const wrong = code === "999999" ? "888888" : "999999";
    for (let n = 0; n < 5; n++) await post("/api/me/verify", { phone: me, code: wrong });
    assert.equal((await post("/api/me/verify", { phone: me, code })).status, 401, "the right code after five misses is too late");
    await post("/api/me/code", { phone: me });
    await post("/api/me/code", { phone: me });
    assert.equal((await post("/api/me/code", { phone: me })).status, 429);
  } finally {
    web.close();
    delete process.env.DB_PATH;
  }
});
