// The pitch deck. An idea that scores 70+ earns one, and "deck" gets one for any idea.
// One model call writes the words; this file lays out six slides and prints them to a PDF with headless Chrome.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { claudeJson, claudeOn } from "./claude.js";
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
  /** What a product photo of this idea in use would show. Never any words in the picture. */
  picture: string;
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
moves: exactly 3 concrete next moves for the next two weeks, in order.
picture: one sentence describing a clean, realistic product photo of this idea in use (the device or object, the setting, the light). No people's faces, no words, no logos, no screens full of text.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    oneLiner: { type: Type.STRING },
    problem: { type: Type.ARRAY, items: { type: Type.STRING } },
    fix: { type: Type.ARRAY, items: { type: Type.STRING } },
    firstUsers: { type: Type.ARRAY, items: { type: Type.STRING } },
    moves: { type: Type.ARRAY, items: { type: Type.STRING } },
    picture: { type: Type.STRING },
  },
  required: ["oneLiner", "problem", "fix", "firstUsers", "moves", "picture"],
};

const claudeSchema = z.object({
  oneLiner: z.string(),
  problem: z.array(z.string()),
  fix: z.array(z.string()),
  firstUsers: z.array(z.string()),
  moves: z.array(z.string()),
  picture: z.string(),
});

/** Some model can write the deck's words. */
const wordsOn = () => claudeOn() || Boolean(process.env.GEMINI_API_KEY);

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
    picture: clean(c.picture),
  };
}

/** The words for the deck. One call, with the same fallback models the scorer uses; no key means a plain stub. */
export async function writeCopy(idea: Idea, facts: string[]): Promise<DeckCopy> {
  if (!wordsOn()) return tidyCopy({}, idea);
  const prompt = [
    `IDEA: ${idea.title}. ${idea.gist}`,
    `IN THEIR WORDS: ${clean(idea.text).slice(0, 800)}`,
    facts.length ? `ABOUT THE BUILDER: ${facts.map(clean).join(". ")}` : "",
    `SCORE: ${idea.score}/100 (problem ${idea.problem}/10, fix ${idea.fix}/10). Verdict: ${idea.verdict}. First move: ${idea.move}`,
  ]
    .filter(Boolean)
    .join("\n");
  let last: unknown;
  if (claudeOn()) {
    try {
      return tidyCopy(await claudeJson({ schema: claudeSchema, system: SYSTEM, prompt, timeoutMs: 40_000 }), idea);
    } catch (err) {
      last = err;
      console.error(`deck: claude failed, ${String((err as Error)?.message ?? err).slice(0, 140)}`);
    }
  }
  if (!process.env.GEMINI_API_KEY) throw last;
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


// ---- the product picture. One per idea and score, cached on disk, and a hard cap per day so it can't eat the budget.
// Price checked 2026-10-04 (ai.google.dev pricing): gemini-3.1-flash-lite-image $0.0336 per 1K image,
// gemini-2.5-flash-image $0.039 per image. 25 a day is under $1 a day at worst.
const IMAGE_MODELS = (process.env.GEMINI_IMAGE_MODELS || "gemini-3.1-flash-lite-image,gemini-2.5-flash-image").split(",").map((m) => m.trim()).filter(Boolean);
const IMAGE_CAP = Number(process.env.DECK_IMAGES_PER_DAY ?? 25);
const COUNT = () => join(DIR, "images-today.json");

function imagesLeft(): number {
  try {
    const c = JSON.parse(readFileSync(COUNT(), "utf8")) as { day: string; n: number };
    return c.day === new Date().toISOString().slice(0, 10) ? IMAGE_CAP - c.n : IMAGE_CAP;
  } catch {
    return IMAGE_CAP;
  }
}
/** For /admin: product pictures drawn today against the daily cap. */
export const imageBudget = () => ({ used: IMAGE_CAP - Math.max(0, imagesLeft()), cap: IMAGE_CAP });

function countImage() {
  const day = new Date().toISOString().slice(0, 10);
  let n = 0;
  try {
    const c = JSON.parse(readFileSync(COUNT(), "utf8")) as { day: string; n: number };
    if (c.day === day) n = c.n;
  } catch {}
  writeFileSync(COUNT(), JSON.stringify({ day, n: n + 1 }));
}

/** Where an idea's product picture lives once it exists. One per idea and score. */
export const pictureFile = (idea: Idea) => join(DIR, `${idea.id}-${idea.score}.jpg`);

/** What the bytes really are: the model may hand back a PNG even though the file says .jpg. */
export function pictureMime(file: string): string {
  const head = readFileSync(file).subarray(0, 4);
  return head[0] === 0x89 && head[1] === 0x50 ? "image/png" : head[0] === 0x52 && head[1] === 0x49 ? "image/webp" : "image/jpeg";
}

// A deck and an "image" text for the same idea can land at once. They share one generation, never two.
const drawing = new Map<string, Promise<string | undefined>>();

/** A product photo for the deck, as a data URL. Undefined when there is no key, no prompt, no budget left, or it fails. */
export function makePicture(idea: Idea, prompt: string): Promise<string | undefined> {
  const key = pictureFile(idea);
  const running = drawing.get(key);
  if (running) return running;
  const job = drawPicture(idea, prompt).finally(() => drawing.delete(key));
  drawing.set(key, job);
  return job;
}

async function drawPicture(idea: Idea, prompt: string): Promise<string | undefined> {
  mkdirSync(DIR, { recursive: true });
  const file = pictureFile(idea);
  if (existsSync(file)) return `data:${pictureMime(file)};base64,${readFileSync(file).toString("base64")}`;
  if (!process.env.GEMINI_API_KEY || !prompt || process.env.DECK_IMAGES === "off") return undefined;
  if (imagesLeft() <= 0) return undefined;
  const ask = `${prompt} Clean, realistic product photography, soft natural light, calm neutral background, plenty of empty space. Absolutely no text, letters, numbers, labels or logos anywhere in the image.`;
  for (const model of IMAGE_MODELS) {
    try {
      countImage(); // count the attempt, not just the success: a failing model can't burn the cap silently
      const res = await ai().models.generateContent({
        model,
        contents: ask,
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" }, httpOptions: { timeout: 30_000 } } as Parameters<GoogleGenAI["models"]["generateContent"]>[0]["config"],
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error("no image in the reply");
      const mime = part.inlineData.mimeType || "image/jpeg";
      writeFileSync(file, Buffer.from(part.inlineData.data, "base64"));
      return `data:${mime};base64,${part.inlineData.data}`;
    } catch (err) {
      console.error(`deck image: ${model} failed, ${String((err as Error)?.message ?? err).slice(0, 140)}`);
      if (imagesLeft() <= 0) return undefined;
    }
  }
  return undefined;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const callOf = (s: number) => (s >= 70 ? "Build it" : s >= 40 ? "Sharpen it" : "Drop it or flip it");

export function deckHtml(idea: Idea, c: DeckCopy, picture?: string) {
  const icon = existsSync(ICON) ? `data:image/png;base64,${readFileSync(ICON).toString("base64")}` : "";
  const total = 6;
  const slide = (n: number, label: string, body: string, cls = "") =>
    `<section class="s ${cls}"><header><span class="lab"><i>${String(n).padStart(2, "0")}</i>${esc(label)}</span><span class="pg">${esc(idea.title)}</span></header>${body}<footer>${icon ? `<img src="${icon}">` : ""}<span>SlopStop</span><span class="pg">${n} / ${total}</span></footer></section>`;
  const titleSize = idea.title.length > 28 ? 76 : idea.title.length > 18 ? 92 : 112;
  const bar = (label: string, v: number, cls: string) =>
    `<div class="bar ${cls}"><div class="bl"><span>${label}</span><b>${v}<small>/10</small></b></div><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(10, v)) * 10}%"></div></div></div>`;
  const [lead, ...rest] = c.problem;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(idea.title)}</title><style>
@page { size: 13.333in 7.5in; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: #fbfaf6 }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #15171a; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.s { width: 13.333in; height: 7.5in; padding: 1.15in 1in 1in; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; background: #fbfaf6; break-after: page }
.s:last-child { break-after: auto }
header { position: absolute; top: 0.55in; left: 1in; right: 1in; display: flex; justify-content: space-between; align-items: center; font-size: 14px; letter-spacing: .12em; text-transform: uppercase; color: #6b6f76; font-weight: 600 }
header .lab { display: flex; align-items: center; gap: 14px; color: #15171a }
header i { font-style: normal; color: #1f7a55; font-weight: 800 }
footer { position: absolute; bottom: 0.5in; left: 1in; right: 1in; display: flex; align-items: center; gap: 10px; font-size: 14px; color: #6b6f76; font-weight: 600 }
footer img { width: 22px; height: 22px; border-radius: 5px }
footer .pg { margin-left: auto }
.rule { width: 72px; height: 6px; background: #1f7a55; border-radius: 3px; margin-bottom: 30px }
h1 { font-weight: 800; letter-spacing: -0.035em; line-height: 0.98 }
h2 { font-size: 58px; line-height: 1.05; letter-spacing: -0.025em; font-weight: 800; max-width: 10.5in }
.lead { font-size: 30px; line-height: 1.32; color: #3d4148; margin-top: 28px; max-width: 9.6in }
.sub { margin-top: 34px; display: grid; gap: 16px; max-width: 10in }
.sub p { font-size: 26px; line-height: 1.35; color: #3d4148; padding-left: 26px; border-left: 4px solid #d9e8df }
.title { display: grid; grid-template-columns: ${picture ? "1.05fr 0.95fr" : "1fr"}; gap: 0.7in; align-items: center; height: 100% }
.title .kick { display: flex; align-items: center; gap: 14px; font-size: 18px; font-weight: 700; color: #1f7a55; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 28px }
.title .kick img { width: 40px; height: 40px; border-radius: 9px }
.pic { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 22px; box-shadow: 0 30px 60px -30px rgba(20, 30, 25, .35) }
.fixs { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 0.8in; align-items: center }
.fixs ul { list-style: none; margin-top: 30px; display: grid; gap: 18px }
.fixs li { font-size: 26px; line-height: 1.35; color: #3d4148; padding-left: 34px; position: relative }
.fixs li::before { content: ""; position: absolute; left: 0; top: 13px; width: 14px; height: 14px; border-radius: 50%; background: #1f7a55 }
.card { background: #fff; border: 1px solid #ebe8df; border-radius: 26px; padding: 40px 42px; box-shadow: 0 24px 50px -34px rgba(20, 30, 25, .3) }
.card .num { display: flex; align-items: baseline; gap: 10px }
.card .num b { font-size: 150px; line-height: .85; font-weight: 800; letter-spacing: -0.05em; color: #15171a }
.card .num span { font-size: 34px; font-weight: 700; color: #9a9ea5 }
.card .call { display: inline-block; margin-top: 18px; font-size: 18px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #fff; background: #1f7a55; padding: 8px 14px; border-radius: 8px }
.card.mid .call { background: #8a6a12 } .card.low .call { background: #6b6f76 }
.bar { margin-top: 26px }
.bl { display: flex; justify-content: space-between; align-items: baseline; font-size: 20px; color: #3d4148; font-weight: 600 }
.bl b { font-size: 26px; color: #15171a } .bl small { font-size: 16px; color: #9a9ea5; font-weight: 600 }
.track { height: 14px; background: #efede6; border-radius: 7px; margin-top: 10px; overflow: hidden }
.fill { height: 100%; border-radius: 7px; background: #1f7a55 }
.fix .fill { background: #b9bdc3 }
.formula { margin-top: 24px; font-size: 16px; color: #9a9ea5; font-family: Menlo, monospace }
.cards { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 26px; margin-top: 44px }
.cards div { background: #fff; border: 1px solid #ebe8df; border-radius: 22px; padding: 30px 30px 34px; font-size: 25px; line-height: 1.35; color: #2a2d32; font-weight: 500 }
.cards div b { display: block; font-size: 44px; font-weight: 800; color: #1f7a55; margin-bottom: 14px; letter-spacing: -0.02em }
.steps { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 0; margin-top: 50px; position: relative }
.steps::before { content: ""; position: absolute; top: 27px; left: 28px; right: 18%; height: 4px; background: #d9e8df }
.steps div { position: relative; padding-right: 34px; font-size: 25px; line-height: 1.35; color: #2a2d32; font-weight: 500 }
.steps div b { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; background: #1f7a55; color: #fff; font-size: 26px; font-weight: 800; margin-bottom: 24px; position: relative }
.steps div em { display: block; font-style: normal; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: #6b6f76; font-weight: 700; margin-bottom: 8px }
.end { background: #15171a; color: #fbfaf6 }
.end header, .end footer { color: #9a9ea5 } .end header .lab { color: #fbfaf6 } .end header i { color: #7fd1a6 }
.end .big { display: flex; align-items: center; gap: 34px }
.end .big img { width: 120px; height: 120px; border-radius: 28px }
.end h2 { font-size: 76px; color: #fbfaf6 }
.end .lead { color: #c9ccd1 } .end .url { color: #7fd1a6; font-weight: 800; font-size: 34px; margin-top: 30px }
</style></head><body>
<section class="s"><div class="title"><div>${icon ? `<div class="kick"><img src="${icon}">Pitch deck</div>` : `<div class="kick">Pitch deck</div>`}<h1 style="font-size:${titleSize}px">${esc(idea.title)}</h1><p class="lead">${esc(c.oneLiner)}</p></div>${picture ? `<img class="pic" src="${picture}">` : ""}</div><footer>${icon ? `<img src="${icon}">` : ""}<span>Made with SlopStop</span><span class="pg">1 / ${total}</span></footer></section>
${slide(2, "The problem", `<div class="rule"></div><h2 style="font-size:${(lead ?? idea.gist).length > 70 ? 46 : 58}px">${esc(lead ?? idea.gist)}</h2>${rest.length ? `<div class="sub">${rest.map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : ""}`)}
${slide(3, "The fix", `<div class="fixs"><div><div class="rule"></div><h2>${esc(callOf(idea.score))}. Not slop.</h2><ul>${c.fix.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div><div class="card ${idea.score >= 70 ? "" : idea.score >= 40 ? "mid" : "low"}"><div class="num"><b>${idea.score}</b><span>/100</span></div><span class="call">${esc(callOf(idea.score))}</span>${bar("Problem pain", idea.problem, "prob")}${bar("Fix pain", idea.fix, "fix")}<div class="formula">score = 10 × problem − 5 × fix</div></div></div>`)}
${slide(4, "First users", `<div class="rule"></div><h2>Who to test it with first</h2><div class="cards" style="--n:${c.firstUsers.length}">${c.firstUsers.map((u, i) => `<div><b>${String(i + 1).padStart(2, "0")}</b>${esc(u)}</div>`).join("")}</div>`)}
${slide(5, "Next moves", `<div class="rule"></div><h2>The next three moves</h2><div class="steps" style="--n:${c.moves.length}">${c.moves.map((m, i) => `<div><b>${i + 1}</b><em>${["This week", "Next week", "Week three"][i] ?? ""}</em>${esc(m)}</div>`).join("")}</div>`)}
${slide(6, "SlopStop", `<div class="big">${icon ? `<img src="${icon}">` : ""}<h2>Made with SlopStop</h2></div><p class="lead">Text it an idea. It scores it out of 100 instantly, then connects you to the builders closest to it.</p><p class="url">slopstop.ink</p>`, "end")}
</body></html>`;
}

const run = (file: string, args: string[], ms: number) =>
  new Promise<void>((ok, fail) => execFile(file, args, { timeout: ms }, (err) => (err ? fail(err) : ok())));

/** Print the deck to a PDF. Cached per idea and score, so asking twice never prints twice. Returns the file path. */
export async function renderDeck(idea: Idea, c: DeckCopy, picture?: string): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const pdf = join(DIR, `${idea.id}-${idea.score}-v2${picture ? "" : "-plain"}.pdf`);
  if (existsSync(pdf)) return pdf;
  const work = mkdtempSync(join(tmpdir(), "slopstop-deck-"));
  try {
    const html = join(work, "deck.html");
    writeFileSync(html, deckHtml(idea, c, picture));
    const out = join(work, "deck.pdf");
    // Its own throwaway profile, so it never touches the Chrome a person has open on this laptop.
    // CHROME_FLAGS adds what a small Linux server needs (e.g. --disable-dev-shm-usage).
    const extra = (process.env.CHROME_FLAGS ?? "").split(/\s+/).filter(Boolean);
    await run(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", ...extra, `--user-data-dir=${join(work, "profile")}`, "--no-pdf-header-footer", `--print-to-pdf=${out}`, `file://${html}`], 45_000);
    if (!existsSync(out)) throw new Error("chrome printed nothing");
    writeFileSync(pdf, readFileSync(out));
    return pdf;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// The deck's words, cached per idea and score: the picture prompt lives in them, so "image" and "deck" agree.
const writing = new Map<string, Promise<DeckCopy>>();
export function copyFor(idea: Idea, facts: string[]): Promise<DeckCopy> {
  const file = join(DIR, `${idea.id}-${idea.score}-copy.json`);
  if (existsSync(file)) {
    try {
      return Promise.resolve(tidyCopy(JSON.parse(readFileSync(file, "utf8")), idea));
    } catch {}
  }
  const running = writing.get(file);
  if (running) return running;
  const job = writeCopy(idea, facts)
    .then((c) => {
      mkdirSync(DIR, { recursive: true });
      if (wordsOn()) writeFileSync(file, JSON.stringify(c));
      return c;
    })
    .finally(() => writing.delete(file));
  writing.set(file, job);
  return job;
}

export type ImageResult = { path: string; mimeType: string } | { miss: "cap" | "fail" };

/** The product picture on its own, for texting. Reuses the deck's cached picture, never draws a second one. */
export async function imageFor(idea: Idea, facts: string[]): Promise<ImageResult> {
  const file = pictureFile(idea);
  if (existsSync(file)) return { path: file, mimeType: pictureMime(file) };
  if (imagesLeft() <= 0) return { miss: "cap" };
  const words = await copyFor(idea, facts).catch(() => undefined);
  if (words?.picture) await makePicture(idea, words.picture).catch(() => undefined);
  if (existsSync(file)) return { path: file, mimeType: pictureMime(file) };
  return { miss: imagesLeft() <= 0 ? "cap" : "fail" };
}

/** The whole thing: words, then the PDF. Pictures are drawn only when someone texts "image" (they are most of the
 *  Gemini bill), so a deck carries the picture only once one exists. DECK_PICTURES=1 draws one for every deck again. */
export async function makeDeck(idea: Idea, facts: string[]): Promise<string> {
  const drawn = existsSync(pictureFile(idea));
  const cached = join(DIR, `${idea.id}-${idea.score}-v2${drawn ? "" : "-plain"}.pdf`);
  if (existsSync(cached)) return cached;
  const copy = await copyFor(idea, facts);
  // The picture is a bonus: if it fails, is over the daily cap or takes too long, the deck ships without it.
  const picture = drawn ? pictureFile(idea) : process.env.DECK_PICTURES === "1" ? await makePicture(idea, copy.picture).catch(() => undefined) : undefined;
  return renderDeck(idea, copy, picture);
}

/** A file-safe name for the attachment people see in Messages. */
export const deckName = (idea: Idea) => `${idea.title.replace(/[^\p{L}\p{N} ]/gu, "").trim().replace(/\s+/g, " ") || "Idea"} pitch deck.pdf`;
