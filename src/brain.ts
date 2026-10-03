// The judgment step: one inbound text in, one structured read out. Gemini rates the two inputs and
// writes the words; score.ts does the math. No key = a crude offline stub so the rest still runs.
import { GoogleGenAI, Type } from "@google/genai";

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
  /** One pivotal question, or empty. */
  ask: string;
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
  mayAsk: boolean;
  image?: { mimeType: string; data: Buffer };
};

const SYSTEM = `You are the brain of an iMessage agent for builders. People text it an idea, or what they are building. It scores it out of 100, then connects them to the builders closest to it.

THE THESIS
Most products are slop not because they fail to work, but because adopting the fix hurts more than the problem did. Fix pain is finding it, onboarding, learning the UX, building the habit, paying, and upkeep. People are lazy, and doing it by hand can even feel fine.

PICK kind
- "idea": a new idea, or something they are building. Texts are often voice-typed brain dumps: find the idea inside the ramble.
- "context": they answered the open question, or added facts about themselves or about the LAST idea. Re-rate the last idea with what you now know: move a number only when the new fact truly changes how much it hurts or what it costs to adopt, and say what changed.
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
- trunk: the broad area, 1-2 lowercase words. Reuse an existing trunk whenever one fits.
- branch: the specific theme inside that trunk, 1-3 lowercase words. Reuse an existing branch whenever one fits. Make a new one only when nothing fits.
- verdict: ONE short sentence. Why the two numbers are what they are, and which side to push: cut the fix, or go after a sharper pain. Code prepends the call (build it / sharpen it / drop it), so never state the call yourself.
- move: ONE concrete thing to do in the next 24 hours to test it. Name the kind of person or place.
- ask: empty unless ASK ALLOWED is yes. When it is yes you know nothing about the sender, so ask the ONE question about the builder's leverage whose answer changes the most at once: where they sit ("you in college?" unlocks clubs, campus resources and a captive first audience), whether they live the problem ("you have this problem yourself?"), or how far along they are ("you already have users?"). Never a detail of the idea and never their hobbies or things they own ("what kind of freelance work?", "you have a dog?" and "you live near mountains?" are bad). Under 8 words. If this text already tells you who they are, leave it empty.
- fact: a durable fact the sender revealed about themselves in THIS message (school, job, role, city), as a short phrase. Otherwise empty.
- plays: kind "context" only, when the new fact opens moves. 2-3 very short specific plays that fact unlocks. Name only resources you are confident exist. Otherwise name the kind of resource.
- reply: kind "chat" only. One short line. If they ask what you do: text me an idea or what you're building, i score it out of 100 and connect you w/ the builders closest to it. If they ask how the score works: score = 10 x problem - 5 x fix, both 0-10. the problem counts double, the fix counts against you.

VOICE for verdict, move, ask, plays and reply: a sharp friend texting. lowercase. very concise. a few common abbreviations are fine (w/, bc, rn, ppl, vs). still professional: no slang for show, no emojis, no hype, no hedging, no em dashes, no semicolons. verdict under 22 words. move under 18 words. each play under 12 words.`;

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
    ask: { type: Type.STRING },
    fact: { type: Type.STRING },
    plays: { type: Type.ARRAY, items: { type: Type.STRING } },
    reply: { type: Type.STRING },
  },
  // The read itself is required every time: a model allowed to skip fields skips the ratings.
  required: ["kind", "title", "gist", "trunk", "branch", "problem", "fix", "verdict", "move"],
};

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
    ask: voice(r.ask),
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
    `ASK ALLOWED: ${ctx.mayAsk ? "yes" : "no"}`,
    `NEW TEXT FROM THEM:\n${text || "(a photo, no text)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const models = () =>
  [process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", ...(process.env.GEMINI_FALLBACK || "gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.6-flash").split(",")]
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

export const online = () => Boolean(process.env.GEMINI_API_KEY);

export async function read(text: string, ctx: BrainContext): Promise<Read> {
  if (!online()) return stub(text, ctx);
  const parts: object[] = [{ text: brief(text, ctx) }];
  if (ctx.image) parts.push({ inlineData: { mimeType: ctx.image.mimeType, data: ctx.image.data.toString("base64") } });
  let last: unknown;
  // "Instantly" is the promise, so the fast model goes first (about a second). The rest are there so a busy model never means silence.
  for (const model of models()) {
    try {
      const res = await ai().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.3,
          httpOptions: { timeout: 10_000 },
        },
      });
      const r = tidy(JSON.parse(res.text ?? "{}"));
      // A read with no ratings or no words is a failed read, not a zero.
      if (r.kind !== "chat" && (!r.problem || !r.verdict)) throw new Error("empty read");
      if (process.env.DEBUG_BRAIN) console.error(`brain: ${model}`);
      return r;
    } catch (err) {
      last = err;
      console.error(`brain: ${model} failed, ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    }
  }
  throw last;
}

/** A unit vector for "how close are two ideas". Undefined when offline or the call fails: matching falls back to branches. */
export async function embed(text: string): Promise<number[] | undefined> {
  if (!online()) return undefined;
  try {
    const res = await ai().models.embedContent({
      model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
      contents: [text],
      config: { outputDimensionality: 256, taskType: "SEMANTIC_SIMILARITY", httpOptions: { timeout: 8_000 } },
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
    ask: ctx.mayAsk && !ctx.facts.length ? "you in college?" : "",
  });
}

const STOP = new Set(
  "that this with which what when where your their them they have from into about just like tells tell finds find make makes thing things text bots right some there would could should really building idea ideas".split(
    " ",
  ),
);
