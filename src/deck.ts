// The pitch deck. An idea that scores 70+ earns one, and "deck" gets one for any idea.
// One model call writes the words; this file lays out six slides and prints them to a PDF with headless Chrome.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";
import type { Idea } from "./store.js";

export type DeckCopy = {
  /** One sentence: what it is and who it is for. */
  oneLiner: string;
  /** 2-3 short lines on the pain, specific to who has it. */
  problem: string[];
  /** 2-3 short lines on the fix and why adopting it is easy. */
  fix: string[];
  /** 2-3 kinds of people or places to test with first. */
  firstUsers: string[];
  /** Exactly 3 next moves, in order. */
  moves: string[];
};

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = resolve(process.cwd(), process.env.DECK_DIR ?? "data/decks");
const ICON = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icon.png");

const models = () =>
  [process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", ...(process.env.GEMINI_FALLBACK || "gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash").split(",")]
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);
let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

const SYSTEM = `You write a six-slide pitch deck for a startup idea someone texted in. Plain, specific, confident, no hype.
Rules: short lines (under 14 words each), sentence case, no emojis, no em dashes, no semicolons, no slang, no exclamation marks.
Never include a person's name, phone number or email. Only use what the idea and context say or clearly imply. Name kinds of people and places, not made-up companies or numbers.
oneLiner: one sentence, what it is and who it is for.
problem: 2-3 lines on how much it hurts and for whom.
fix: 2-3 lines on what the fix is and why adopting it costs almost nothing.
firstUsers: 2-3 kinds of people or places to test it with first.
moves: exactly 3 concrete next moves for the next two weeks, in order.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    oneLiner: { type: Type.STRING },
    problem: { type: Type.ARRAY, items: { type: Type.STRING } },
    fix: { type: Type.ARRAY, items: { type: Type.STRING } },
    firstUsers: { type: Type.ARRAY, items: { type: Type.STRING } },
    moves: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["oneLiner", "problem", "fix", "firstUsers", "moves"],
};

// What the model is told never to write, enforced anyway: no dashes, no emojis, no phone numbers or emails.
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/;/g, ",")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "")
    .replace(/\S+@\S+\.\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
const lines = (a: unknown, n: number) => (Array.isArray(a) ? a : []).map(clean).filter(Boolean).slice(0, n);

export function tidyCopy(c: Partial<DeckCopy>, idea: Idea): DeckCopy {
  const moves = lines(c.moves, 3);
  return {
    oneLiner: clean(c.oneLiner) || idea.gist || idea.title,
    problem: lines(c.problem, 3).length ? lines(c.problem, 3) : [idea.gist],
    fix: lines(c.fix, 3).length ? lines(c.fix, 3) : [clean(idea.verdict)],
    firstUsers: lines(c.firstUsers, 3).length ? lines(c.firstUsers, 3) : [clean(idea.move)],
    moves: moves.length ? moves : [clean(idea.move)],
  };
}

/** The words for the deck. One call, with the same fallback models the scorer uses; no key means a plain stub. */
export async function writeCopy(idea: Idea, facts: string[]): Promise<DeckCopy> {
  if (!process.env.GEMINI_API_KEY) return tidyCopy({}, idea);
  const prompt = [
    `IDEA: ${idea.title}. ${idea.gist}`,
    `IN THEIR WORDS: ${clean(idea.text).slice(0, 800)}`,
    facts.length ? `ABOUT THE BUILDER: ${facts.map(clean).join(". ")}` : "",
    `SCORE: ${idea.score}/100 (problem ${idea.problem}/10, fix ${idea.fix}/10). Verdict: ${idea.verdict}. First move: ${idea.move}`,
  ]
    .filter(Boolean)
    .join("\n");
  let last: unknown;
  for (const model of models()) {
    try {
      const res = await ai().models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseSchema: schema, temperature: 0.3, httpOptions: { timeout: 15_000 } },
      });
      return tidyCopy(JSON.parse(res.text ?? "{}"), idea);
    } catch (err) {
      last = err;
      console.error(`deck: ${model} failed, ${String((err as Error)?.message ?? err).slice(0, 140)}`);
    }
  }
  throw last;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const list = (a: string[]) => `<ul>${a.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
const callOf = (s: number) => (s >= 70 ? "Build it" : s >= 40 ? "Sharpen it" : "Drop it or flip it");

export function deckHtml(idea: Idea, c: DeckCopy) {
  const icon = existsSync(ICON) ? `data:image/png;base64,${readFileSync(ICON).toString("base64")}` : "";
  const slide = (label: string, body: string) => `<section class="s"><div class="k">${icon ? `<img src="${icon}">` : ""}${esc(label)}</div>${body}<div class="f">SlopStop · slopstop.ink</div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(idea.title)}</title><style>
@page { size: 13.333in 7.5in; margin: 0 }
* { box-sizing: border-box; margin: 0 }
html, body { background: #060a18 }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #eef2fb; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.s { width: 13.333in; height: 7.5in; padding: 0.8in 0.95in; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center;
  background: radial-gradient(85% 75% at 62% 40%, #12224a 0%, #0a1230 40%, #060a18 74%, #03050d 100%); break-after: page }
.s:last-child { break-after: auto }
.k { position: absolute; top: 0.6in; left: 0.95in; display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #ffc24a }
.k img { width: 30px; height: 30px; border-radius: 7px }
.f { position: absolute; bottom: 0.55in; left: 0.95in; font-size: 14px; color: #93a0c0 }
h1 { font-size: 92px; line-height: 1; letter-spacing: -0.03em; font-weight: 800 }
h2 { font-size: 54px; line-height: 1.06; letter-spacing: -0.02em; font-weight: 800; max-width: 11in }
.lead { font-size: 30px; line-height: 1.3; color: #c9d3ee; margin-top: 26px; max-width: 10.5in }
ul { list-style: none; padding: 0; margin-top: 30px }
li { font-size: 30px; line-height: 1.3; padding: 12px 0 12px 34px; position: relative; color: #dfe6f8; max-width: 10.8in }
li::before { content: ""; position: absolute; left: 0; top: 26px; width: 14px; height: 14px; border-radius: 50%; background: #55cf96 }
ol { padding: 0; margin-top: 30px; counter-reset: m; list-style: none }
ol li::before { counter-increment: m; content: counter(m); width: 44px; height: 44px; top: 12px; left: 0; background: #ffc24a; color: #060a18; font-weight: 800; font-size: 24px; display: grid; place-items: center }
ol li { padding-left: 66px; min-height: 68px }
.big { display: flex; align-items: baseline; gap: 18px; margin-top: 10px }
.big b { font-size: 150px; line-height: .9; font-weight: 800; color: #ffc24a; letter-spacing: -0.04em }
.big span { font-size: 40px; color: #93a0c0; font-weight: 700 }
.nums { display: flex; gap: 40px; margin-top: 22px; font-size: 26px; color: #c9d3ee }
.nums em { font-style: normal; font-weight: 800; color: #eef2fb }
.formula { margin-top: 18px; font-family: Menlo, monospace; font-size: 20px; color: #93a0c0 }
.cols { display: grid; grid-template-columns: 1fr 1.25fr; gap: 0.7in; align-items: center }
.title { display: flex; align-items: center; gap: 30px }
.title img { width: 110px; height: 110px; border-radius: 24px }
.end { text-align: left }
.end h2 { color: #ffc24a }
</style></head><body>
${slide("Pitch deck", `<div class="title">${icon ? `<img src="${icon}">` : ""}<h1>${esc(idea.title)}</h1></div><p class="lead">${esc(c.oneLiner)}</p>`)}
${slide("The problem", `<h2>How much it hurts</h2>${list(c.problem)}`)}
${slide(
  "The fix",
  `<div class="cols"><div><div class="big"><b>${idea.score}</b><span>/100</span></div><div class="nums"><div>problem <em>${idea.problem}</em>/10</div><div>fix <em>${idea.fix}</em>/10</div></div><div class="formula">score = 10 × problem − 5 × fix</div></div><div><h2>${esc(callOf(idea.score))}. Not slop.</h2>${list(c.fix)}</div></div>`,
)}
${slide("First users", `<h2>Who to test it with first</h2>${list(c.firstUsers)}`)}
${slide("Next moves", `<h2>The next three moves</h2><ol>${c.moves.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>`)}
${slide("", `<div class="end"><h2>Made with SlopStop</h2><p class="lead">Text it an idea. It scores it out of 100 instantly, then connects you to the builders closest to it.</p><p class="lead" style="color:#55cf96">slopstop.ink</p></div>`)}
</body></html>`;
}

const run = (file: string, args: string[], ms: number) =>
  new Promise<void>((ok, fail) => execFile(file, args, { timeout: ms }, (err) => (err ? fail(err) : ok())));

/** Print the deck to a PDF. Cached per idea and score, so asking twice never prints twice. Returns the file path. */
export async function renderDeck(idea: Idea, c: DeckCopy): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const pdf = join(DIR, `${idea.id}-${idea.score}.pdf`);
  if (existsSync(pdf)) return pdf;
  const work = mkdtempSync(join(tmpdir(), "slopstop-deck-"));
  try {
    const html = join(work, "deck.html");
    writeFileSync(html, deckHtml(idea, c));
    const out = join(work, "deck.pdf");
    // Its own throwaway profile, so it never touches the Chrome a person has open on this laptop.
    await run(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(work, "profile")}`, "--no-pdf-header-footer", `--print-to-pdf=${out}`, `file://${html}`], 45_000);
    if (!existsSync(out)) throw new Error("chrome printed nothing");
    writeFileSync(pdf, readFileSync(out));
    return pdf;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The whole thing: words, then the PDF. */
export async function makeDeck(idea: Idea, facts: string[]): Promise<string> {
  const cached = join(DIR, `${idea.id}-${idea.score}.pdf`);
  if (existsSync(cached)) return cached;
  return renderDeck(idea, await writeCopy(idea, facts));
}

/** A file-safe name for the attachment people see in Messages. */
export const deckName = (idea: Idea) => `${idea.title.replace(/[^\p{L}\p{N} ]/gu, "").trim().replace(/\s+/g, " ") || "Idea"} pitch deck.pdf`;
