// The judgment step: one inbound text in, one structured read out. Claude rates the two inputs and writes the
// words (Gemini when Claude is off or failing); score.ts does the math. No key = a crude offline stub so the rest still runs.
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { claudeJson, claudeOn } from "./claude.js";

export type Read = {
  kind: "idea" | "context" | "chat";
  title: string;
  gist: string;
  trunk: string;
  branch: string;
  problem: number;
  fix: number;
  verdict: string;
  move: string;
  /** Which of the three pivotal questions to ask, if any. Code owns the wording. */
  ask: "" | "college" | "self" | "users";
  /** The text held more than one idea. Only the first was rated. */
  more: boolean;
  /** A durable fact the sender revealed about themselves, or empty. */
  fact: string;
  /** Moves a new fact unlocked (kind "context"). */
  plays: string[];
  /** kind "chat" only. */
  reply: string;
};

export type BrainContext = {
  tree: { trunk: string; branches: string[] }[];
  facts: string[];
  last?: { title: string; gist: string; text: string; problem: number; fix: number };
  /** The question we asked last, if it is still open. */
  question?: string;
  /** The text itself says it is pitching something new ("new idea", "another one"). */
  fresh?: boolean;
  mayAsk: boolean;
  image?: { mimeType: string; data: Buffer };
};

const SYSTEM = `You are the brain of an iMessage agent for builders. People text it an idea, or what they are building. It scores it out of 100, then connects them to the builders closest to it.

THE THESIS
Most products are slop not because they fail to work, but because adopting the fix hurts more than the problem did. Fix pain is finding it, onboarding, learning the UX, building the habit, paying, and upkeep. People are lazy, and doing it by hand can even feel fine.

PICK kind
- "idea": a new idea, or something they are building. Texts are often voice-typed brain dumps: find the idea inside the ramble. If the text answers your open question AND ALSO pitches a different idea ("new idea", "another one", "scratch that"), it is an "idea": rate the NEW one, and put what they told you about themselves in fact.
- "context": they answered the open question, or added facts about themselves or about the LAST idea, and pitched nothing new. Re-rate the last idea with what you now know: move a number only when the new fact truly changes how much it hurts or what it costs to adopt, and say what changed.
- "chat": anything else (a greeting, a question about you, thanks). Fill only reply.

RATE (idea and context). Two integers. Code computes the score as 10 x problem - 5 x fix, so do not compute it.
problem 0-10, how much it hurts the person it is for to keep living with it:
  1-2 mild annoyance. 3-4 recurring irritation people shrug at. 5-6 real friction, people complain and hack workarounds. 7-8 costs real time, money or opportunity every week and people look for fixes. 9-10 hair on fire: blocks income, health, safety or a deadline.
fix 0-10, what it costs a user to adopt THIS fix as described:
  0-1 nothing to install or learn, it lives where they already are. 2-3 one-time setup under a minute and no new habit. 4-5 a new app or account and some learning, or occasional upkeep. 6-7 a new daily habit, data entry, paying, or it needs other people to join too. 8-10 heavy onboarding, behavior change, hardware, switching cost, or it only works at network scale.
Rate what they described, not the best version of it. Be honest and specific to who it is for. Use the whole scale.

FIELDS
- title: 2-4 plain words naming it, 22 characters at most, sentence case (capitalize the first word and proper nouns only). No quotes, no period.
- gist: one plain sentence: who it is for and the problem it solves. Leave out how it is delivered (app, text line, bot, site), so two ideas about the same problem read alike.
- trunk: the broad area, 1-2 lowercase words. Reuse an existing trunk only when the idea truly belongs there, otherwise name a new one.
- branch: the specific theme inside that trunk, 1-3 lowercase words. Reuse an existing branch only when this idea is about the same thing. An idea about something else gets its own branch: never file an idea under a branch just because it exists.
- verdict: ONE short sentence. Why the two numbers are what they are, and which side to push: cut the fix, or go after a sharper pain. Code prepends the call (build it / sharpen it / drop it), so never state the call yourself.
- move: ONE concrete thing to do in the next 24 hours to test it. Name the kind of person or place.
- ask: "none" unless ASK ALLOWED is yes. When it is yes you know nothing about the sender, so pick the ONE question about the builder's leverage whose answer would change the most: "self" (do they have this problem themselves), "users" (do they already have users). If this text already tells you who they are, "none".
- more: true only if the text pitches more than one separate idea. Rate the first one.
- fact: a durable fact the sender revealed about themselves in THIS message (school, job, role, city), as a short phrase. Otherwise empty.
- plays: kind "context" only, when the new fact opens moves. 2-3 very short specific plays that fact unlocks. Name only resources you are confident exist. Otherwise name the kind of resource.
- reply: kind "chat" only. One short line that answers what they actually asked, using what you know (their last idea and its two numbers). If they ask what you are or say hi: text me an idea or what you're building, i score it out of 100 and connect you w/ the builders closest to it. If they ask how the score works or how you know: i rate how much the problem hurts and what the fix costs to adopt, then score = 10 x problem - 5 x fix. If it is only a reaction (lol, ok, an emoji), reply is empty. Never state a score or any number out of 100 in reply: code owns the score. You cannot delete, change or look anything up, and you know nothing about other builders or the map: never say you did something and never describe who else is out there.

VOICE for verdict, move, plays and reply: a sharp friend texting. lowercase. very concise. a few common abbreviations are fine (w/, bc, rn, ppl, vs). still professional: no slang for show, no emojis, no hype, no hedging, no em dashes, no semicolons. verdict under 22 words. move under 18 words. each play under 12 words.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, enum: ["idea", "context", "chat"] },
    title: { type: Type.STRING },
    gist: { type: Type.STRING },
    trunk: { type: Type.STRING },
    branch: { type: Type.STRING },
    problem: { type: Type.INTEGER },
    fix: { type: Type.INTEGER },
    verdict: { type: Type.STRING },
    move: { type: Type.STRING },
    ask: { type: Type.STRING, enum: ["none", "college", "self", "users"] },
    more: { type: Type.BOOLEAN },
    fact: { type: Type.STRING },
    plays: { type: Type.ARRAY, items: { type: Type.STRING } },
    reply: { type: Type.STRING },
  },
  // The read itself is required every time: a model allowed to skip fields skips the ratings.
  required: ["kind", "title", "gist", "trunk", "branch", "problem", "fix", "verdict", "move"],
};

// The same shape for Claude. Every field is asked for every time: a model allowed to skip fields skips the ratings.
const claudeSchema = z.object({
  kind: z.enum(["idea", "context", "chat"]),
  title: z.string(),
  gist: z.string(),
  trunk: z.string(),
  branch: z.string(),
  problem: z.number().int(),
  fix: z.number().int(),
  verdict: z.string(),
  move: z.string(),
  ask: z.enum(["none", "college", "self", "users"]),
  more: z.boolean(),
  fact: z.string(),
  plays: z.array(z.string()),
  reply: z.string(),
});

// The model is told the rules; this enforces the ones that can never slip into a text.
const say = (s: unknown) =>
  String(s ?? "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const voice = (s: unknown) => say(s).replace(/;/g, ",").replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
const label = (s: unknown, fallback: string) =>
  say(s).toLowerCase().replace(/[^a-z0-9 &'/-]/g, "").split(" ").slice(0, 3).join(" ") || fallback;
/** Models ramble. Past the word budget, keep only the first sentence. */
const brief1 = (s: string, words: number) => (s.split(" ").length <= words ? s : (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s));
const rate = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

function tidy(r: Partial<Read>): Read {
  const kind = r.kind === "context" || r.kind === "chat" ? r.kind : "idea";
  return {
    kind,
    title: say(r.title).replace(/^["']|["'.]+$/g, "").replace(/^\p{Ll}/u, (c) => c.toUpperCase()) || "Untitled",
    gist: say(r.gist),
    trunk: label(r.trunk, "misc"),
    branch: label(r.branch, "misc"),
    problem: rate(r.problem),
    fix: rate(r.fix),
    verdict: brief1(voice(r.verdict), 30),
    move: voice(r.move).replace(/^next:\s*/i, ""),
    ask: r.ask === "college" || r.ask === "self" || r.ask === "users" ? r.ask : "",
    more: Boolean(r.more),
    fact: voice(r.fact),
    plays: (r.plays ?? []).map(voice).filter(Boolean).slice(0, 3),
    reply: voice(r.reply),
  };
}

function brief(text: string, ctx: BrainContext) {
  const tree = ctx.tree.map((t) => `${t.trunk}: ${t.branches.join(", ")}`).join("\n");
  return [
    tree ? `EXISTING MAP (trunk: branches)\n${tree}` : "EXISTING MAP: empty, you are naming the first branches.",
    ctx.facts.length ? `ABOUT THE SENDER: ${ctx.facts.join(". ")}` : "ABOUT THE SENDER: nothing yet.",
    ctx.last
      ? `THEIR LAST IDEA: ${ctx.last.title}. ${ctx.last.gist} (problem ${ctx.last.problem}, fix ${ctx.last.fix})\nIn their words: ${ctx.last.text.slice(0, 600)}`
      : "THEIR LAST IDEA: none.",
    ctx.question ? `OPEN QUESTION YOU ASKED: ${ctx.question}` : "",
    ctx.fresh ? "NOTE: this text announces a new idea, so kind is \"idea\". Rate the new one." : "",
    `ASK ALLOWED: ${ctx.mayAsk ? "yes" : "no"}`,
    `NEW TEXT FROM THEM:\n${text || "(a photo, no text)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// The free key allows about 15 reads a minute per model, so the backups matter: each has its own allowance.
const models = () =>
  [process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", ...(process.env.GEMINI_FALLBACK || "gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash").split(",")]
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

const geminiOn = () => Boolean(process.env.GEMINI_API_KEY);
/** Some brain is there to read texts. */
export const online = () => geminiOn() || claudeOn();

/** A read with no ratings or no words is a failed read, not a zero. */
const usable = (r: Read) => r.kind === "chat" || (r.problem > 0 && Boolean(r.verdict));

export async function read(text: string, ctx: BrainContext): Promise<Read> {
  if (!online()) return stub(text, ctx);
  if (claudeOn()) {
    try {
      const r = tidy((await claudeJson({ schema: claudeSchema, system: SYSTEM, prompt: brief(text, ctx), image: ctx.image })) as Partial<Read>);
      if (!usable(r)) throw new Error("empty read");
      if (process.env.DEBUG_BRAIN) console.error("brain: claude");
      return r;
    } catch (err) {
      console.error(`brain: claude failed, ${String((err as Error)?.message ?? err).slice(0, 160)}; trying gemini`);
      if (!geminiOn()) throw err;
    }
  }
  const parts: object[] = [{ text: brief(text, ctx) }];
  if (ctx.image) parts.push({ inlineData: { mimeType: ctx.image.mimeType, data: ctx.image.data.toString("base64") } });
  let last: unknown;
  // "Instantly" is the promise, so the fast model goes first (about a second). The rest are there so a busy model
  // never means silence. If every one of them is rate limited, wait a few seconds and go round once more.
  for (const round of [0, 1]) {
    if (round) await new Promise((r) => setTimeout(r, 6000));
    for (const model of models()) {
      try {
        const res = await ai().models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseSchema: schema, temperature: 0, httpOptions: { timeout: 10_000 } },
        });
        const r = tidy(JSON.parse(res.text ?? "{}"));
        if (!usable(r)) throw new Error("empty read");
        if (process.env.DEBUG_BRAIN) console.error(`brain: ${model}`);
        return r;
      } catch (err) {
        last = err;
        console.error(`brain: ${model} failed, ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      }
    }
    if (!/"code":429|RESOURCE_EXHAUSTED/.test(String((last as Error)?.message ?? last))) break;
  }
  throw last;
}

/** Are two ideas the same problem for the same kind of person? The closeness score finds candidates; this decides.
 *  Undefined when it could not be asked. Runs on the backup model first, so it never competes with scoring. */
export async function judge(a: { title: string; gist: string }, b: { title: string; gist: string }): Promise<boolean | undefined> {
  if (!online()) return undefined;
  const prompt = `Two builders each texted an idea.\nA: ${a.title}. ${a.gist}\nB: ${b.title}. ${b.gist}\nWould these two get real value from meeting because they are working on the same problem for the same kind of person? Sharing an audience (both for students) or a format (both text bots) is not enough.`;
  if (claudeOn()) {
    try {
      return (await claudeJson({ schema: z.object({ same: z.boolean() }), prompt, timeoutMs: 15_000, maxTokens: 2000 })).same;
    } catch (err) {
      console.error(`brain: judge on claude failed, ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      if (!geminiOn()) return undefined;
    }
  }
  for (const model of [...models().slice(1, 2), ...models().slice(0, 1)]) {
    try {
      const res = await ai().models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { same: { type: Type.BOOLEAN } }, required: ["same"] }, temperature: 0, httpOptions: { timeout: 10_000 } },
      });
      return Boolean(JSON.parse(res.text ?? "{}").same);
    } catch (err) {
      console.error(`brain: judge on ${model} failed, ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }
  return undefined;
}

/** A unit vector for "how close are two ideas". Undefined when offline or the call fails: matching falls back to branches. */
export async function embed(text: string): Promise<number[] | undefined> {
  // Claude has no embeddings. This stays on Gemini, and costs a fraction of a cent.
  if (!geminiOn()) return undefined;
  try {
    const res = await ai().models.embedContent({
      model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
      contents: [text],
      config: { outputDimensionality: 256, taskType: "SEMANTIC_SIMILARITY", httpOptions: { timeout: 10_000 } },
    });
    const v = res.embeddings?.[0]?.values;
    if (!v?.length) return undefined;
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => Math.round((x / norm) * 1e4) / 1e4);
  } catch (err) {
    console.error(`brain: embed failed, ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    return undefined;
  }
}

// Offline stub so the whole path runs with no key. Not smart, just shaped right.
function stub(text: string, ctx: BrainContext): Read {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const content = words.filter((w) => w.length > 3 && !STOP.has(w));
  if (ctx.question) {
    return tidy({
      kind: "context",
      ...ctx.last,
      trunk: ctx.tree[0]?.trunk,
      branch: ctx.tree[0]?.branches[0],
      problem: Math.min(10, (ctx.last?.problem ?? 5) + 1),
      verdict: "offline stub, add GEMINI_API_KEY for a real read.",
      move: "ask three ppl who have this problem how they handle it today.",
      fact: text,
      plays: ["start w/ the ppl closest to you"],
    });
  }
  if (content.length < 2) return tidy({ kind: "chat", reply: "text me an idea or what you're building." });
  const all = ctx.tree.flatMap((t) => t.branches.map((b) => ({ trunk: t.trunk, branch: b })));
  const hit = all.find((b) => b.branch.split(" ").some((w) => content.includes(w)));
  return tidy({
    kind: "idea",
    title: content.slice(0, 3).join(" "),
    gist: text.slice(0, 140),
    trunk: hit?.trunk ?? "misc",
    branch: hit?.branch ?? content[0],
    problem: 5 + (/hate|every|always|broken|waste/.test(text) ? 2 : 0),
    fix: 4 + (/\bapp\b|download|sign up|dashboard/.test(text) ? 2 : 0) - (/\btext\b|imessage|sms/.test(text) ? 2 : 0),
    verdict: "offline stub, add GEMINI_API_KEY for a real read.",
    move: "ask three ppl who have this problem how they handle it today.",
    ask: ctx.mayAsk && !ctx.facts.length ? "college" : "",
  });
}

const STOP = new Set(
  "that this with which what when where your their them they have from into about just like tells tell finds find make makes thing things text bots right some there would could should really building idea ideas".split(
    " ",
  ),
);
