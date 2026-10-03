// The promises the product makes, checked without a phone or a model: the math, the yes/no parsing,
// and the intro rules (ask one side first, swap numbers only on two yeses, never match private ideas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, yesNo, type Out } from "../src/core.js";
import { score, call } from "../src/score.js";
import { JsonStore } from "../src/store.js";
import type { Read } from "../src/brain.js";

const read = (over: Partial<Read>): Read => ({
  kind: "idea", title: "Library seat finder", gist: "students cannot find open library seats", trunk: "campus life", branch: "study spots",
  problem: 7, fix: 2, verdict: "real pain, light fix.", move: "ask five ppl.", ask: "", fact: "", plays: [], reply: "", ...over,
});

function world(brain: (text: string) => Partial<Read> = () => ({})) {
  const store = new JsonStore(join(mkdtempSync(join(tmpdir(), "bearing-")), "db.json"));
  const sent: { to: string; out: Out[] }[] = [];
  const deps = { store, send: async (to: string, out: Out[]) => void sent.push({ to, out }), brain: async (t: string) => read(brain(t)), embed: async () => undefined };
  const text = (from: string, body: string) => handle(from, body, deps);
  const said = (to: string) => sent.filter((s) => s.to === to).flatMap((s) => s.out).map((o) => (o.type === "text" ? o.text : `[${o.type}]`)).join("\n");
  return { store, sent, text, said };
}

test("the score is 10 x problem - 5 x fix, clamped to 0-100", () => {
  assert.equal(score(9, 2), 80);
  assert.equal(score(10, 0), 100);
  assert.equal(score(2, 6), 0);
  assert.equal(score(5, 5), 25);
  assert.equal(score(99, -3), 100);
  assert.deepEqual([call(70), call(69), call(40), call(39)], ["build", "sharpen", "sharpen", "drop"]);
});

test("a short yes carries a name; a sentence that starts with yes is not an answer", () => {
  assert.deepEqual(yesNo("yes dylan"), { yes: true, name: "Dylan" });
  assert.deepEqual(yesNo("yeah i'm Rithik"), { yes: true, name: "Rithik" });
  assert.deepEqual(yesNo("nah"), { yes: false });
  assert.equal(yesNo("yeah im a sophomore at cornell"), undefined);
  assert.equal(yesNo("no idea what this is tbh"), undefined);
});

test("an idea gets one number out of 100 with the two inputs beside it", async () => {
  const w = world();
  await w.text("+15550001", "a text line for open library seats");
  assert.match(w.said("+15550001"), /^\[react\]\n60\/100\nproblem 7 · fix 2\nsharpen it\. real pain, light fix\.\nnext: ask five ppl\./);
});

test("the one question is asked once, only when nobody is near, and its answer re-reads the idea", async () => {
  const w = world((t) => (/cornell/.test(t) ? { kind: "context", problem: 8, fact: "cornell sophomore", plays: ["pitch it at appdev"] } : { ask: "you in college?" }));
  await w.text("+15550001", "open library seats by text");
  assert.match(w.said("+15550001"), /you in college\?$/);
  await w.text("+15550001", "yeah im a sophomore at cornell");
  assert.match(w.said("+15550001"), /70\/100 now, was 60/);
  assert.match(w.said("+15550001"), /1\. pitch it at appdev/);
  assert.deepEqual(w.store.user("+15550001").facts, ["cornell sophomore"]);
  await w.text("+15550001", "another idea entirely");
  assert.equal(w.said("+15550001").match(/you in college\?/g)?.length, 1);
});

test("an intro asks the new builder first, and swaps numbers only when both say yes", async () => {
  const w = world();
  await w.text("+15550001", "open library seats by text");
  await w.text("+15550002", "library seat tracker from wifi counts");
  assert.match(w.said("+15550002"), /one builder's close/);
  assert.doesNotMatch(w.said("+15550001"), /wants to meet you/, "the first builder hears nothing until the second says yes");
  await w.text("+15550002", "yes sam");
  assert.match(w.said("+15550001"), /wants to meet you/);
  assert.equal(w.sent.some((s) => s.out.some((o) => o.type === "contact")), false, "no numbers yet");
  await w.text("+15550001", "yes, i'm Dylan");
  const cards = w.sent.flatMap((s) => s.out.filter((o) => o.type === "contact").map((o) => ({ to: s.to, ...o })));
  assert.deepEqual(cards.map((c) => [c.to, c.type === "contact" && c.name, c.type === "contact" && c.handle]), [
    ["+15550002", "Dylan", "+15550001"],
    ["+15550001", "Sam", "+15550002"],
  ]);
  assert.equal(w.store.intros()[0].status, "connected");
});

test("a no ends it quietly, and nobody's number moves", async () => {
  const w = world();
  await w.text("+15550001", "open library seats by text");
  await w.text("+15550002", "library seat tracker");
  await w.text("+15550002", "yes sam");
  await w.text("+15550001", "nah");
  assert.equal(w.store.intros()[0].status, "declined");
  assert.equal(w.sent.some((s) => s.out.some((o) => o.type === "contact")), false);
  assert.match(w.said("+15550002"), /heads down rn/);
});

test("private ideas stay off the map and out of intros; stop means no more pings", async () => {
  const w = world();
  await w.text("+15550001", "private: open library seats by text");
  assert.equal(w.store.mapIdeas().length, 0);
  await w.text("+15550002", "library seat tracker");
  assert.match(w.said("+15550002"), /nobody's near this yet/);
  await w.text("+15550002", "stop");
  await w.text("+15550003", "library seats again");
  assert.match(w.said("+15550003"), /nobody's near this yet/, "someone who opted out is never offered as a match");
});

test("forget me wipes the ideas, the record and any open intro", async () => {
  const w = world();
  await w.text("+15550001", "open library seats by text");
  await w.text("+15550002", "library seat tracker");
  await w.text("+15550002", "yes sam");
  await w.text("+15550001", "forget me");
  assert.equal(w.store.ideasBy("+15550001").length, 0);
  assert.equal(w.store.intros().length, 0);
  assert.deepEqual(w.store.user("+15550002").pending, []);
});

test("an answer and a new idea in one text is a new idea, and the old one is left alone", async () => {
  // The model gets this wrong on its own (it calls the whole text an answer), which is how it was found.
  const w = world((t) => (/new idea/i.test(t) ? { kind: "context", title: "Persona prank bot", gist: "friends prank each other", problem: 4, fix: 2 } : { ask: "you already have users?" }));
  await w.text("+15550001", "a text line that scores ideas");
  await w.text("+15550001", "No I'll go do that tho. New idea is a persona bot to prank your friends");
  const mine = w.store.ideasBy("+15550001");
  assert.deepEqual(mine.map((i) => [i.title, i.score]), [["Library seat finder", 60], ["Persona prank bot", 30]]);
  assert.equal(mine[0].was, undefined);
});

test("me reads back what it knows, and me: replaces it and re-reads the last idea", async () => {
  const w = world((t) => (/^me:/.test(t) ? { kind: "chat", problem: 9, plays: ["pitch it at appdev"] } : {}));
  await w.text("+15550001", "me");
  assert.match(w.said("+15550001"), /nothing yet/);
  await w.text("+15550001", "open library seats by text");
  await w.text("+15550001", "me: cornell sophomore, i run a club");
  assert.deepEqual(w.store.user("+15550001").facts, ["cornell sophomore, i run a club"]);
  assert.match(w.said("+15550001"), /80\/100 now, was 60/);
  await w.text("+15550001", "me");
  assert.match(w.said("+15550001"), /what i know: cornell sophomore, i run a club\./);
});
