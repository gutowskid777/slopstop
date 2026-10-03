// The judgment step: one idea in, a verdict out. Gemini when a key is set, a crude offline stub when not.
import { GoogleGenAI, Type } from "@google/genai";

export type Analysis = {
  title: string;
  branch: string;
  parent?: string;
  problemPain: number;
  solutionPain: number;
  verdict: string;
  nextAction: string;
};

export type BrainContext = { branches: string[]; about?: string };

const SYSTEM = `You judge startup and project ideas texted in by builders.
The thesis: AI slop is not slop because it fails. It is slop because the pain of adopting the solution
(finding it, onboarding, learning the UX, building the habit, paying, upkeep) is bigger than the pain of the problem.
Score honestly:
- problemPain 1-10: how much it hurts to keep living with the problem, for the person it is for.
- solutionPain 1-10: how much it would cost a user to adopt this solution as described.
- verdict: one blunt sentence on whether the ratio clears the bar and why. No hype.
- nextAction: ONE concrete thing to do in the next 24 hours to test it (talk to a named kind of person, a fake door, a manual version).
- title: 2-5 words.
- branch: a short lowercase theme (1-3 words) that groups ideas. Reuse an existing branch when it fits.
- parent: optional broader branch.
Never use em dashes or emojis.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    branch: { type: Type.STRING },
    parent: { type: Type.STRING },
    problemPain: { type: Type.INTEGER },
    solutionPain: { type: Type.INTEGER },
    verdict: { type: Type.STRING },
    nextAction: { type: Type.STRING },
  },
  required: ["title", "branch", "problemPain", "solutionPain", "verdict", "nextAction"],
};

const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(Number(n) || 5)));
const clean = (s: string) => (s ?? "").replace(/\s*[—–]\s*/g, ", ").trim();

function tidy(a: Analysis): Analysis {
  return {
    title: clean(a.title),
    branch: clean(a.branch).toLowerCase(),
    parent: a.parent ? clean(a.parent).toLowerCase() : undefined,
    problemPain: clamp(a.problemPain),
    solutionPain: clamp(a.solutionPain),
    verdict: clean(a.verdict),
    nextAction: clean(a.nextAction),
  };
}

export async function analyze(text: string, ctx: BrainContext): Promise<Analysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return stub(text, ctx);
  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = [
    ctx.branches.length ? `Existing branches: ${ctx.branches.join(", ")}` : "No branches yet.",
    ctx.about ? `About the sender: ${ctx.about}` : "",
    `Idea: ${text}`,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: prompt,
    config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseSchema: schema },
  });
  return tidy(JSON.parse(res.text ?? "{}"));
}

// Offline stub so the whole path runs with no key. Not smart, just shaped right.
function stub(text: string, ctx: BrainContext): Analysis {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const content = words.filter((w) => w.length > 3 && !STOP.has(w));
  const hit = ctx.branches.find((b) => b.split(" ").some((w) => content.includes(w)));
  return tidy({
    title: content.slice(0, 3).join(" ") || "untitled idea",
    branch: hit ?? content[0] ?? "misc",
    problemPain: 5 + (/hate|every|always|broken/.test(text) ? 2 : 0),
    solutionPain: 4 + (/\bapp\b|download|sign up/.test(text) ? 2 : 0),
    verdict: "Offline stub verdict. Add GEMINI_API_KEY for a real read.",
    nextAction: "Ask three people who have this problem how they handle it today.",
  });
}

const STOP = new Set(
  "that this with which what when where your their them they have from into about just like tells tell finds find make makes thing things text bots right some there would could should really".split(" "),
);
