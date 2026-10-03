// One inbound text in, messages out. Transport-free, so the iMessage agent and the terminal harness share it.
// Every reply is a decision (the score) or a connection (an intro). Nothing else gets sent.
import { read as readBrain, embed as embedBrain, type Read, type BrainContext } from "./brain.js";
import { score, call } from "./score.js";
import { nearest } from "./match.js";
import { newId, type Idea, type Intro, type Store, type User } from "./store.js";

/** What the core wants sent. The transport decides how (bubble, tapback, effect, contact card). */
export type Out =
  | { type: "text"; text: string; effect?: "slam" | "confetti" }
  | { type: "react"; emoji: "love" | "like" }
  | { type: "contact"; name: string; handle: string; note: string };

export type Deps = {
  store: Store;
  /** Deliver messages to a handle. The sender gets them as replies; anyone else as a direct message. */
  send: (to: string, out: Out[]) => Promise<void>;
  brain?: (text: string, ctx: BrainContext) => Promise<Read>;
  embed?: (text: string) => Promise<number[] | undefined>;
  /** Only texted when it is a real public URL. */
  mapUrl?: string;
  /** Something the map shows has changed. */
  changed?: () => void;
};

const t = (text: string, effect?: "slam" | "confetti"): Out => ({ type: "text", text, effect });

// Every word the agent can say that the model didn't write. Tone: a sharp friend texting. Lowercase, short, no filler.
const copy = {
  pitch: "text me an idea or what you're building. i score it out of 100 and connect you w/ the builders closest to it.",
  how: "score = 10 x problem - 5 x fix, both rated 0-10. the problem has to hurt about 2x what the fix costs to adopt.\nalso: mine, private, public, map, stop, forget me.",
  call: { build: "build it.", sharpen: "sharpen it.", drop: "drop it or flip it." },
  told: 'fyi the title is on the map, no name attached. "private" pulls it.',
  alone: "nobody's near this yet. you'll hear from me when a builder wants in.",
  nothingOpen: "nothing open rn. text me an idea or what you're building.",
  empty: "nothing yet. text me an idea or what you're building.",
  private: "kept private. off the map, no intros.",
  public: "back on the map.",
  noIdea: "no idea to change yet. text me one.",
  muted: 'done. no more intros or pings from me. text "start" to undo.',
  forgotten: "done. your ideas, your number and your intros are wiped on my side.",
  unmuted: "you're back in.",
  busy: "that's a lot for one hour. pick your best one and text it tmrw.",
  down: "my brain's down for a sec. text that again in a min.",
  declinedA: "no intro. nobody's told.",
  askedB: "asked them. you get their number the second they're in.",
  declinedB: "all good. they're not told why.",
  passed: "they're heads down rn. i'll flag the next close one.",
  noMap: "the map isn't public yet. ask whoever showed you this.",
};

const YES = /^(y|yes|yea|yeah|yep|yup|ya|sure|ok|okay|k|bet|down|in|i'?m in|do it|let'?s do it|pls|please|def|definitely|for sure|absolutely)\b/i;
const NO = /^(n|no|nope|nah|pass|not now|no thanks|skip)\b/i;
const NOT_A_NAME = new Set(
  "please pls thanks thank thx sure intro do it lol yes yeah ok okay lets let's go and the a an to me my name is im i'm i am this its it's call down in for now rn".split(" "),
);

/** A short yes or no, plus a first name if they tacked one on ("yes dylan", "yeah i'm Rithik"). */
export function yesNo(text: string): { yes: boolean; name?: string } | undefined {
  const s = text.trim().replace(/[.!]+$/, "");
  if (NO.test(s)) return s.split(/\s+/).length <= 3 ? { yes: false } : undefined;
  if (!YES.test(s)) return undefined;
  // Whatever follows the yes has to be a name and nothing else, or this is a sentence, not an answer.
  const rest = s
    .replace(YES, "")
    .replace(/^[\s,:-]*(?:i'?m|i am|this is|my name is|my name'?s|it'?s|name'?s|call me|pls|please)?[\s,:-]*/i, "")
    .trim();
  if (!rest) return { yes: true };
  const words = rest.split(/\s+/);
  if (words.length > 2 || words.some((w) => !/^\p{L}[\p{L}'-]*$/u.test(w) || NOT_A_NAME.has(w.toLowerCase()))) return undefined;
  return { yes: true, name: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") };
}

/** "private: my idea" keeps it off the map from the start. The colon matters: "private equity tracker" is just an idea. */
const PRIVATE = /^private\s*[:,-]\s*/i;

const scoreLine = (i: Pick<Idea, "score" | "problem" | "fix">) => `${i.score}/100\nproblem ${i.problem} · fix ${i.fix}`;

export async function handle(sender: string, raw: string, d: Deps, image?: BrainContext["image"]) {
  const text = raw.trim().slice(0, 4000);
  if (!text && !image) return;
  const { store } = d;
  const user = store.user(sender);
  const lower = text.toLowerCase().replace(/[.!?]+$/, "");
  const say = (...out: Out[]) => d.send(sender, out);

  if (/^(stop|unsubscribe|quit|leave me alone)$/.test(lower)) {
    store.saveUser({ ...user, muted: true, pending: [] });
    return say(t(copy.muted));
  }
  if (/^(forget me|delete me|delete my (data|ideas|stuff))$/.test(lower)) {
    store.forget(sender);
    d.changed?.();
    return say(t(copy.forgotten));
  }
  if (lower === "start" && user.muted) {
    store.saveUser({ ...user, muted: false });
    return say(t(copy.unmuted));
  }

  // An open intro question owns a short yes or no. Anything longer is treated as a normal text.
  const top = user.pending.at(-1);
  const yn = yesNo(text);
  if (yn && top?.kind === "intro") {
    user.pending.pop();
    if (yn.name && !user.name) user.name = yn.name;
    store.saveUser(user);
    return answerIntro(user, top.introId, yn.yes, d);
  }
  if (yn && !yn.name && !top) return say(t(copy.nothingOpen));

  if (/^(mine|my ideas|list)$/.test(lower)) {
    const mine = store.ideasBy(sender);
    if (!mine.length) return say(t(copy.empty));
    return say(t(mine.map((i, n) => `${n + 1}. ${i.title}, ${i.score}${i.private ? " (private)" : ""}`).join("\n")));
  }
  if (/^(map|the map|show me the map)$/.test(lower)) {
    return say(t(d.mapUrl && !/localhost|127\.0\.0\.1/.test(d.mapUrl) ? d.mapUrl : copy.noMap));
  }
  // "why", "help", "how do you score it", "how does the score work": the math, in one text.
  if (
    /^(why|how|help|\?|commands|score|how (does|do) (this|it|you) work)$/.test(lower) ||
    (/^(how|why|what)\b.*\b(scor\w*|rated|rating|math)\b/.test(lower) && lower.split(/\s+/).length <= 9)
  ) {
    return say(t(copy.how));
  }

  const vis = lower.match(/^(?:make it |keep it |go )?(public|private)(?:\s+#?(\d+))?$/);
  if (vis) {
    const mine = store.ideasBy(sender);
    const idea = vis[2] ? mine[Number(vis[2]) - 1] : (store.idea(user.lastIdea ?? "") ?? mine.at(-1));
    if (!idea) return say(t(copy.noIdea));
    idea.private = vis[1] === "private";
    store.saveIdea(idea);
    d.changed?.();
    await say(t(idea.private ? copy.private : copy.public));
    if (!idea.private) await offerIntro(idea, store.user(sender), d);
    return;
  }

  const hourAgo = Date.now() - 3600_000;
  if (store.ideasBy(sender).filter((i) => Date.parse(i.created) > hourAgo).length >= 20) return say(t(copy.busy));

  // Everything else goes to the brain: a new idea, more context on the last one, or small talk.
  const last = store.idea(user.lastIdea ?? "");
  const openAsk = top?.kind === "ask" ? top : undefined;
  let r: Read;
  try {
    r = await (d.brain ?? readBrain)(text.replace(PRIVATE, ""), {
      tree: store.tree(),
      facts: user.facts,
      last: last && { title: last.title, gist: last.gist, text: last.text, problem: last.problem, fix: last.fix },
      question: openAsk?.question,
      // One question, once: only while we know nothing about them. After that it never interviews.
      mayAsk: !openAsk && !user.facts.length && !user.askedOn,
      image,
    });
  } catch (err) {
    console.error(err);
    return say(t(copy.down));
  }

  if (r.fact && !user.facts.some((f) => f.toLowerCase() === r.fact.toLowerCase())) user.facts = [...user.facts, r.fact].slice(-8);

  if (r.kind === "chat" || (r.kind === "context" && !last)) {
    store.saveUser(user);
    return say(t(r.kind === "chat" && r.reply ? r.reply : copy.pitch));
  }

  if (r.kind === "context" && last) return addContext(user, store.idea(openAsk?.ideaId ?? "") ?? last, r, d);

  const s = score(r.problem, r.fix);
  const idea: Idea = {
    id: newId(),
    owner: sender,
    text: text || "(photo)",
    title: r.title,
    gist: r.gist || r.title,
    trunk: r.trunk,
    branch: r.branch,
    problem: r.problem,
    fix: r.fix,
    score: s,
    verdict: r.verdict,
    move: r.move,
    private: PRIVATE.test(text),
    // Matching reads the gist: who it is for and the problem, not the form factor.
    vec: await (d.embed ?? embedBrain)(r.gist || r.title),
    created: new Date().toISOString(),
  };
  store.addIdea(idea);
  user.lastIdea = idea.id;
  user.pending = user.pending.filter((p) => p.kind !== "ask");
  d.changed?.();

  const out: Out[] = [];
  if (s >= 40) out.push({ type: "react", emoji: s >= 70 ? "love" : "like" });
  out.push(t(scoreLine(idea), s >= 80 ? "slam" : undefined));
  out.push(t(`${copy.call[call(s)]} ${r.verdict}${r.move ? `\nnext: ${r.move}` : ""}`));
  if (idea.private) out.push(t(copy.private));

  store.saveUser(user);
  await say(...out);
  if (idea.private) return;
  // A connection beats a question. The one question only gets asked when nobody is close yet,
  // and not when this same text already told us who they are.
  const mayAsk = Boolean(r.ask) && !r.fact && !user.facts.length && !user.askedOn;
  if (mayAsk && !closeTo(idea, user, store).length) {
    user.pending.push({ kind: "ask", ideaId: idea.id, question: r.ask });
    user.askedOn = idea.id;
    store.saveUser(user);
    return say(t(r.ask));
  }
  await offerIntro(idea, store.user(sender), d);
}

// New context landed (an answer to the one question, or more detail). Re-read the same idea in place.
async function addContext(user: User, idea: Idea, r: Read, d: Deps) {
  const { store } = d;
  const before = idea.score;
  const s = score(r.problem, r.fix);
  if (s !== before || r.problem !== idea.problem || r.fix !== idea.fix) {
    idea.was = [...(idea.was ?? []), { problem: idea.problem, fix: idea.fix, score: before, at: new Date().toISOString() }];
  }
  Object.assign(idea, { problem: r.problem, fix: r.fix, score: s, verdict: r.verdict, move: r.move });
  if (r.gist && r.gist !== idea.gist) {
    idea.gist = r.gist;
    idea.vec = (await (d.embed ?? embedBrain)(r.gist)) ?? idea.vec;
  }
  store.saveIdea(idea);
  user.pending = user.pending.filter((p) => p.kind !== "ask");
  store.saveUser(user);
  d.changed?.();

  // Only say the number again if it moved. Otherwise the new context pays off as plays.
  const plays = r.plays.length ? `\n${r.plays.map((p, n) => `${n + 1}. ${p}`).join("\n")}` : r.move ? `\nnext: ${r.move}` : "";
  const out: Out[] =
    s === before
      ? [t(`still ${s}/100. ${r.verdict}${plays}`)]
      : [
          t(`${s}/100 now, was ${before}\nproblem ${idea.problem} · fix ${idea.fix}`, s >= 80 && s > before ? "slam" : undefined),
          t(`${copy.call[call(s)]} ${r.verdict}${plays}`),
        ];
  await d.send(user.id, out);
  if (!idea.private && !store.intros().some((x) => x.ideaA === idea.id)) await offerIntro(idea, store.user(user.id), d);
}

/** Close builders this person has not already been offered. */
const closeTo = (idea: Idea, user: User, store: Store) => nearest(idea, store).filter((n) => !store.introBetween(user.id, n.idea.owner));

// The connection. Ask the new builder first; the other side only hears about it after a yes.
async function offerIntro(idea: Idea, user: User, d: Deps) {
  const { store } = d;
  if (user.muted) return;
  const near = closeTo(idea, user, store);
  // The first time, say once that the title is on the map. It rides here so the score lands alone.
  const fyi: Out[] = user.told ? [] : [t(copy.told)];
  user.told = true;
  if (!near.length) {
    store.saveUser(user);
    return d.send(user.id, [t(copy.alone), ...fyi]);
  }
  const pick = near[0].idea;
  const intro: Intro = { id: newId(), a: user.id, b: pick.owner, ideaA: idea.id, ideaB: pick.id, status: "offered", created: new Date().toISOString() };
  store.addIntro(intro);
  user.pending.push({ kind: "intro", introId: intro.id });
  store.saveUser(user);
  const count = near.length === 1 ? "one builder's close." : `${near.length} builders are close.`;
  const who = `${near.length === 1 ? "they're" : "the closest is"} on "${pick.title}" (${pick.score}/100).`;
  await d.send(user.id, [t(`${count} ${who}\nwant an intro? i swap your numbers if they're in too. ${nameAsk(user)}`), ...fyi]);
}

const nameAsk = (u: User) => (u.name ? "yes / no" : "reply yes + your first name");

async function answerIntro(user: User, introId: string, yes: boolean, d: Deps) {
  const { store } = d;
  const intro = store.intro(introId);
  if (!intro || intro.status === "connected" || intro.status === "declined") return d.send(user.id, [t(copy.nothingOpen)]);
  const ia = store.idea(intro.ideaA);
  const ib = store.idea(intro.ideaB);

  if (user.id === intro.a) {
    if (!yes) {
      store.saveIntro({ ...intro, status: "declined" });
      return d.send(user.id, [t(copy.declinedA)]);
    }
    store.saveIntro({ ...intro, status: "asked" });
    const b = store.user(intro.b);
    b.pending.push({ kind: "intro", introId: intro.id });
    store.saveUser(b);
    await d.send(intro.b, [
      t(`a builder on "${ia?.title}" wants to meet you. it's close to your "${ib?.title}".\nin? i swap your numbers. ${nameAsk(b)}`),
    ]);
    return d.send(user.id, [t(copy.askedB)]);
  }

  if (!yes) {
    store.saveIntro({ ...intro, status: "declined" });
    await d.send(intro.a, [t(copy.passed)]);
    return d.send(user.id, [t(copy.declinedB)]);
  }
  store.saveIntro({ ...intro, status: "connected" });
  d.changed?.();
  const a = store.user(intro.a);
  const b = store.user(intro.b);
  const card = (them: User, theirs?: Idea): Out[] => {
    const name = them.name ?? "A builder";
    return [
      t(`connected. ${them.name ?? "they're"} ${them.name ? "is " : ""}on "${theirs?.title}". say hi.`, "confetti"),
      { type: "contact", name, handle: them.id, note: `Building: ${theirs?.title ?? "something close to yours"}` },
    ];
  };
  await d.send(intro.a, card(b, ib));
  await d.send(intro.b, card(a, ia));
}
