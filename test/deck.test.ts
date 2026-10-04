import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Idea } from "../src/store.js";

const dir = mkdtempSync(join(tmpdir(), "deck-test-"));
process.env.DECK_DIR = dir;
const { deckHtml, makePicture, tidyCopy } = await import("../src/deck.js");

const idea: Idea = { created: new Date().toISOString(), id: "t1", owner: "x", text: "an idea", title: "Elevator outage alerts", gist: "Texts students when an elevator is down.", trunk: "getting around", branch: "access", problem: 9, fix: 1, score: 85, verdict: "v", move: "m", private: false };

test("the deck is six light slides with the real numbers, and a picture only when there is one", () => {
  const c = tidyCopy({ oneLiner: "One line.", problem: ["Hurts a lot."], fix: ["Text it."], firstUsers: ["Students"], moves: ["Ask three"], picture: "a phone" }, idea);
  const html = deckHtml(idea, c, "data:image/jpeg;base64,AAAA");
  assert.equal((html.match(/<section /g) ?? []).length, 6);
  assert.match(html, /<b>85<\/b>/);
  assert.match(html, /class="pic"/);
  assert.doesNotMatch(deckHtml(idea, c), /class="pic"/);
  assert.doesNotMatch(html, /#060a18/); // not the app's night theme
});

test("no picture past the daily cap, and the cap is never spent when there is nothing to draw", async () => {
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key-not-used";
  writeFileSync(join(dir, "images-today.json"), JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: 999 }));
  assert.equal(await makePicture(idea, "a phone on a desk"), undefined);
  assert.equal(await makePicture(idea, ""), undefined);
  if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
});
