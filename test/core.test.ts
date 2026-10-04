// The promises the product makes, checked without a phone or a model: the math, the yes/no parsing,
// the intro rules (ask one side first, swap numbers only on two real yeses, never match private ideas),
// and the things real texts broke: an answer plus a new idea, "delete that", "who's near me", "ok".
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
  problem: 7, fix: 2, verdict: "real pain, light fix.", move: "ask five ppl.", ask: "", more: false, fact: "", plays: [], reply: "", ...over,
});

function world(brain: (text: string) => Partial<Read> = () => ({}), same = true) {
  const store = new JsonStore(join(mkdtempSync(join(tmpdir(), "bearing-")), "db.json"));
  const sent: { to: string; out: Out[] }[] = [];
  const deps = {
    store,
    send: async (to: string, out: Out[]) => void sent.push({ to, out }),
    brain: async (t: string) => read(brain(t)),
    embed: async () => undefined,
    judge: async () => same,
    deck: async () => "/tmp/test-deck.pdf",
    image: async () => ({ path: "/tmp/test-image.jpg", mimeType: "image/jpeg" }),
  };
  const text = (from: string, body: string) => handle(from, body, deps);
  const said = (to: string) => sent.filter((s) => s.to === to).flatMap((s) => s.out).map((o) => (o.type === "text" ? o.text : `[${o.type}]`)).join("\n");
  const last = (to: string) => sent.filter((s) => s.to === to).at(-1)?.out.map((o) => (o.type === "text" ? o.text : `[${o.type}]`)).join("\n") ?? "";
  return { store, sent, text, said, last };
}

test("the score is 10 x problem - 5 x fix, clamped to 0-100", () => {
  assert.equal(score(9, 2), 80);
  assert.equal(score(10, 0), 100);
  assert.equal(score(2, 6), 0);
  assert.equal(score(5, 5), 25);
  assert.equal(score(99, -3), 100);
  assert.deepEqual([call(70), call(69), call(40), call(39)], ["build", "sharpen", "sharpen", "drop"]);
});

test("a short yes carries a name; a sentence that starts with yes is not an answer; ok is not a yes", () => {
  assert.deepEqual(yesNo("yes dylan"), { yes: true, name: "Dylan" });
  assert.deepEqual(yesNo("yeah i'm Rithik"), { yes: true, name: "Rithik" });
  assert.deepEqual(yesNo("nah"), { yes: false });
  assert.equal(yesNo("yeah im a sophomore at cornell"), undefined);
  assert.equal(yesNo("no idea what this is tbh"), undefined);
  assert.equal(yesNo("ok"), undefined);
});

test("an idea gets one number out of 100 with the two inputs beside it", async () => {
  const w = world();
  await w.text("+15550001", "a text line for open library seats");
  assert.match(w.said("+15550001"), /^\[react\]\n60\/100\nproblem 7 · fix 2\nsharpen it\. real pain, light fix\.\nnext: ask five ppl\./);
});

test("the one question is asked once, only when nobody is near, and its answer re-reads the idea", async () => {
  const w = world((t) => (/cornell/.test(t) ? { kind: "context", problem: 8, fact: "cornell sophomore", plays: ["pitch it at appdev"] } : { ask: "college" }));
  await w.text("+15550001", "open library seats by text");
  assert.match(w.said("+15550001"), /you have this problem yourself\?$/);
  await w.text("+15550001", "yeah im a sophomore at cornell");
  assert.match(w.said("+15550001"), /70\/100 now, was 60/);
  assert.match(w.said("+15550001"), /1\. pitch it at appdev/);
  assert.deepEqual(w.store.user("+15550001").facts, ["cornell sophomore"]);
  await w.text("+15550001", "another idea entirely");
  assert.equal(w.said("+15550001").match(/you have this problem yourself\?/g)?.length, 1);
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

test("two ideas that only share an audience are not introduced", async () => {
  const w = world(() => ({}), false);
  await w.text("+15550001", "a dorm laundry tracker");
  await w.text("+15550002", "a way to share class notes");
  assert.match(w.said("+15550002"), /nobody's near this yet/);
  assert.equal(w.store.intros().length, 0);
});

test("an open intro: ok is not consent, a question gets an answer, later keeps it open", async () => {
  const w = world();
  await w.text("+15550001", "open library seats by text");
  await w.text("+15550002", "library seat tracker");
  await w.text("+15550002", "ok");
  assert.match(w.last("+15550002"), /is that a yes to the intro/);
  await w.text("+15550002", "who is it?");
  assert.match(w.last("+15550002"), /can't say who until they're in too\. they're on "Library seat finder" \(60\/100\)/);
  await w.text("+15550002", "maybe later");
  assert.match(w.last("+15550002"), /no rush/);
  assert.equal(w.store.intros()[0].status, "offered");
  assert.doesNotMatch(w.said("+15550001"), /wants to meet you/);
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
  const w = world((t) => (/new idea/i.test(t) ? { kind: "context", title: "Persona prank bot", gist: "friends prank each other", branch: "pranks", problem: 4, fix: 2 } : { ask: "users" }));
  await w.text("+15550001", "a text line that scores ideas");
  assert.match(w.last("+15550001"), /anyone using it yet\?/);
  await w.text("+15550001", "No I'll go do that tho. New idea is a persona bot to prank your friends");
  const mine = w.store.ideasBy("+15550001");
  assert.deepEqual(mine.map((i) => [i.title, i.score]), [["Library seat finder", 60], ["Persona prank bot", 30]]);
  assert.equal(mine[0].was, undefined);
});

test("delete that really deletes, and scratch that swaps the last idea for the new one", async () => {
  const w = world((t) => (/standup/.test(t) ? { title: "Standup bot", branch: "standups" } : {}));
  await w.text("+15550001", "a browser extension that blocks shorts");
  await w.text("+15550001", "delete that");
  assert.match(w.last("+15550001"), /gone\. it's off the map/);
  assert.equal(w.store.ideasBy("+15550001").length, 0);
  await w.text("+15550001", "a discord bot that summarizes chats");
  await w.text("+15550001", "actually scratch that, new idea: a slack bot that writes standup updates");
  assert.deepEqual(w.store.ideasBy("+15550001").map((i) => i.title), ["Standup bot"]);
});

test("who's near me is answered from the store, never by the model", async () => {
  const w = world(() => ({ kind: "chat", reply: "you've got a few builders near you" }));
  await w.text("+15550001", "who's near me");
  assert.doesNotMatch(w.said("+15550001"), /a few builders/);
  const w2 = world();
  await w2.text("+15550001", "open library seats by text");
  await w2.text("+15550001", "who's near me?");
  assert.match(w2.last("+15550001"), /nobody's near this yet/);
});

test("reactions get no reply once you have an idea; a newcomer still gets told what this is", async () => {
  const w = world();
  await w.text("+15550001", "lol");
  assert.match(w.last("+15550001"), /text me an idea/);
  await w.text("+15550001", "open library seats by text");
  const before = w.sent.length;
  await w.text("+15550001", "lol");
  await w.text("+15550001", "ok");
  await w.text("+15550001", "🔥🔥");
  assert.equal(w.sent.length, before);
  await w.text("+15550001", "thanks");
  assert.equal(w.last("+15550001"), "anytime.");
  await w.text("+15550001", "?");
  assert.match(w.last("+15550001"), /score = 10 x problem - 5 x fix/);
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

test("a 70+ idea earns the picture then the deck, last, after the score and the connection", async () => {
  const w = world(() => ({ problem: 9, fix: 2 }));
  const decks: string[] = [];
  const deps = { store: w.store, send: async (to: string, out: Out[]) => void w.sent.push({ to, out }), brain: async () => read({ problem: 9, fix: 2 }), embed: async () => undefined, judge: async () => true, deck: async (i: { id: string }) => (decks.push(i.id), `/tmp/${i.id}.pdf`), image: async () => ({ path: "/tmp/p.png", mimeType: "image/png" }) };
  await handle("+15550001", "a text line for open library seats", deps);
  const out = w.sent.filter((s) => s.to === "+15550001").flatMap((s) => s.out);
  assert.equal(decks.length, 1);
  assert.match(out.map((o) => (o.type === "text" ? o.text : `[${o.type}]`)).join("\n"), /^\[react\]\n80\/100[\s\S]*nobody's near this yet[\s\S]*\[file\]\nit's a build\. here's your deck\.\n\[file\]$/);
  const pic = out.at(-3);
  assert.ok(pic?.type === "file" && pic.mimeType === "image/png" && /\.png$/.test(pic.name));
  const file = out.at(-1);
  assert.ok(file?.type === "file" && file.mimeType === "application/pdf" && /pitch deck\.pdf$/.test(file.name));
});

test("under 70 there is no deck until they text deck, and deck 2 picks the second idea", async () => {
  const w = world(() => ({ problem: 6, fix: 3 }));
  const decks: string[] = [];
  const deps = { store: w.store, send: async (to: string, out: Out[]) => void w.sent.push({ to, out }), brain: async (t: string) => read({ problem: 6, fix: 3, title: t.slice(0, 20) }), embed: async () => undefined, judge: async () => false, deck: async (i: { title: string }) => (decks.push(i.title), "/tmp/x.pdf"), image: async () => ({ miss: "fail" as const }) };
  await handle("+15550002", "first idea about seats", deps);
  await handle("+15550002", "second idea about laundry", deps);
  assert.equal(decks.length, 0);
  await handle("+15550002", "deck", deps);
  await handle("+15550002", "deck 1", deps);
  assert.deepEqual(decks, ["second idea about la", "first idea about sea"]);
  assert.match(w.last("+15550002"), /^here's your deck\.\n\[file\]$/);
});

test("a deck that fails says so and the conversation keeps going", async () => {
  const w = world();
  const deps = { store: w.store, send: async (to: string, out: Out[]) => void w.sent.push({ to, out }), brain: async () => read({}), embed: async () => undefined, judge: async () => false, deck: async () => { throw new Error("chrome died"); }, image: async () => ({ miss: "fail" as const }) };
  await handle("+15550003", "deck", deps);
  assert.match(w.last("+15550003"), /no idea to make a deck for yet/);
  await handle("+15550003", "an idea about seats", deps);
  await handle("+15550003", "send me the deck", deps);
  assert.match(w.last("+15550003"), /deck's not working rn, try again in a min\./);
});

test("image, photo or pic sends the picture for any idea; the cap and failures get one line", async () => {
  const w = world(() => ({ problem: 5, fix: 3 }));
  const asked: string[] = [];
  let next: { path: string; mimeType: string } | { miss: "cap" | "fail" } = { path: "/tmp/a.jpg", mimeType: "image/jpeg" };
  const deps = { store: w.store, send: async (to: string, out: Out[]) => void w.sent.push({ to, out }), brain: async (t: string) => read({ problem: 5, fix: 3, title: t.slice(0, 12) }), embed: async () => undefined, judge: async () => false, deck: async () => "/tmp/x.pdf", image: async (i: { title: string }) => (asked.push(i.title), next) };
  await handle("+15550009", "pic", deps);
  assert.match(w.last("+15550009"), /no idea to draw yet/);
  await handle("+15550009", "first idea seats", deps);
  await handle("+15550009", "second idea laundry", deps);
  assert.equal(asked.length, 0); // under 70: no picture until asked
  await handle("+15550009", "photo", deps);
  assert.match(w.last("+15550009"), /^\[file\]$/);
  await handle("+15550009", "send me a picture 1", deps);
  assert.deepEqual(asked, ["second idea ", "first idea s"]);
  next = { miss: "cap" };
  await handle("+15550009", "image", deps);
  assert.match(w.last("+15550009"), /image limit hit for today, the deck still works\./);
});
