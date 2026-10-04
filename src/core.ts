// One inbound text in, messages out. Transport-free, so the iMessage agent and the terminal harness share it.
// Every reply is a decision (the score) or a connection (an intro). Nothing else gets sent.
import { read as readBrain, embed as embedBrain, judge as judgeBrain, type Read, type BrainContext } from "./brain.js";
import { score, call } from "./score.js";
import { candidates, nearest, CLOSE, SURE } from "./match.js";
import { newId, type Idea, type Intro, type Store, type User } from "./store.js";
import { makeDeck, deckName, imageFor, type ImageResult } from "./deck.js";

/** What the core wants sent. The transport decides how (bubble, tapback, effect, contact card). */
export type Out =
  | { type: "text"; text: string; effect?: "slam" | "confetti" }
  | { type: "react"; emoji: "love" | "like" }
  | { type: "contact"; name: string; handle: string; note: string }
  | { type: "file"; path: string; name: string; mimeType: string };

export type Deps = {
  store: Store;
  /** Deliver messages to a handle. The sender gets them as replies; anyone else as a direct message. */
  send: (to: string, out: Out[]) => Promise<void>;
  brain?: (text: string, ctx: BrainContext) => Promise<Read>;
  embed?: (text: string) => Promise<number[] | undefined>;
  /** Same problem, same kind of person? Undefined when it could not be asked. */
  judge?: (a: Idea, b: Idea) => Promise<boolean | undefined>;
  /** Make the pitch deck PDF for an idea and return its path. */
  deck?: (idea: Idea, facts: string[]) => Promise<string>;
  /** The idea's product picture (the same one the deck uses), or why there isn't one. */
  image?: (idea: Idea, facts: string[]) => Promise<ImageResult>;
  /** Only texted when it is a real public URL. */
  mapUrl?: string;
  /** Something the map shows has changed. */
  changed?: () => void;
};

const t = (text: string, effect?: "slam" | "confetti"): Out => ({ type: "text", text, effect });

// Every word the agent can say that the model didn't write. Tone: a sharp friend texting. Lowercase, short, no filler.
const copy = {
  pitch: "text me an idea or what you're building. i score it out of 100 and connect you w/ the builders closest to it.",
  how: "score = 10 x problem - 5 x fix, both rated 0-10. the problem counts double, the fix counts against you.\nalso: deck, image, mine, me, near, delete, private, public, map, stop, forget me.",
  // The one question, once. The model picks which; the wording is fixed so it never turns into an interview.
  ask: { college: "you have this problem yourself?", self: "you have this problem yourself?", users: "anyone using it yet?" },
  more: "text the other idea on its own and i'll score that too.",
  meEmpty: 'nothing yet. text "me: ..." and tell me anything: school, what you do, who you build for.',
  meSet: "got it. that's what i know about you now.",
  call: { build: "build it.", sharpen: "sharpen it.", drop: "drop it or flip it." },
  told: 'fyi the title is on the map, no name attached. "private" pulls it.',
  alone: "nobody's near this yet. you'll hear from me when a builder wants in.",
  nothingOpen: "nothing open rn. text me an idea or what you're building.",
  empty: "nothing yet. text me an idea or what you're building.",
  private: "kept private. off the map, no intros.",
  public: "back on the map.",
  gone: "gone. it's off the map.",
  noIdea: "no idea to change yet. text me one.",
  muted: 'done. no more intros or pings from me. text "start" to undo.',
  forgotten: "done. your ideas, your number and your intros are wiped on my side.",
  unmuted: "you're back in.",
  thanks: "anytime.",
  busy: "that's a lot for one hour. pick your best one and text it tmrw.",
  down: "my brain's down for a sec. text that again in a min.",
  introAck: "is that a yes to the intro? reply yes or no.",
  introLater: "no rush. reply yes or no whenever.",
  declinedA: "no intro. nobody's told.",
  askedB: "asked them. you get their number the second they're in.",
  declinedB: "all good. they're not told why.",
  passed: "they're heads down rn. i'll flag the next close one.",
  noMap: "the map isn't public yet. ask whoever showed you this.",
  deckEarned: "it's a build. here's your deck.",
  deckEarnedNow: "it's a build now. here's your deck.",
  deckMaking: "making your deck, one sec.",
  deckHere: "here's your deck.",
  deckDown: "deck's not working rn, try again in a min.",
  deckNone: "no idea to make a deck for yet. text me one.",
  imageMaking: "drawing it, one sec.",
  imageCap: "image limit hit for today, the deck still works.",
  imageDown: "image's not working rn, the deck still works.",
  imageNone: "no idea to draw yet. text me one.",
};

// Swapping numbers needs a real yes. "ok" and "k" are acknowledgements, not consent, so they are not on this list.
const YES = /^(y|yes|yea|yeah|yep|yup|ya|sure|bet|down|in|i'?m in|do it|let'?s do it|pls|please|def|definitely|for sure|absolutely)\b/i;
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

/** A reaction, not a message: nothing here needs an answer. */
const ACK = /^(lol|lmao|lmfao|ha(ha)+|he(he)+|ok|okay|k|kk|cool|nice|word|got it|sounds good|ight|aight|alright|wow|damn|fr|true|facts|thanks|thank you|thx|ty)$/;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}‍️\s]+$/u;
const ABOUT_ME = /^(?:about me|me)\s*[:,-]\s*(.+)$/is;
/** "new idea", "another one": the text says outright that it is pitching something new. */
const FRESH = /\b(new|another|different|next|second|other)\s+(idea|one)\b|\bscratch that\b/i;
/** "scratch that, ..." at the very start: drop the last idea, then read the rest. */
const SCRATCH = /^(?:actually[\s,]+)?(?:scratch|forget|ignore|nvm|never ?mind)(?:\s+(?:that|it|the last one))?[\s,.:-]+(?=\S)/i;
const DELETE = /^(?:(?:delete|remove|undo|scratch|drop|erase)(?:\s+(?:that|it|this|that one|my last idea|the last one|my idea))?|nvm|never ?mind)$/;
const NEAR = /^(?:(?:who'?s|whos|who is|anyone|anybody|who else)\b.*\b(?:near|close|nearby|similar)\b.*|near|nearby|near me|close to me)$/;
/** "private: my idea" keeps it off the map from the start. The colon matters: "private equity tracker" is just an idea. */
const PRIVATE = /^private\s*[:,-]\s*/i;
/** "image", "photo", "pic 2", "send me a picture": the product picture for any idea at any score. */
const IMAGE = /^(?:(?:send|make|give|show)\s+(?:me\s+)?)?(?:(?:a|an|the|my)\s+)?(?:product\s+)?(?:image|photo|pic|picture|pics)(?:\s+(?:for\s+)?#?(\d+))?(?:\s+(?:pls|please))?$/;

/** "deck", "deck 2", "send me the deck", "make me a deck": the override, a deck for any idea at any score. */
const DECK = /^(?:(?:send|make|give)\s+(?:me\s+)?)?(?:(?:a|the|my)\s+)?(?:pitch\s+)?(?:deck|slides|slide deck)(?:\s+(?:for\s+)?#?(\d+))?(?:\s+(?:pls|please))?$/;

const scoreLine = (i: Pick<Idea, "score" | "problem" | "fix">) => `${i.score}/100\nproblem ${i.problem} · fix ${i.fix}`;
const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function handle(sender: string, raw: string, d: Deps, image?: BrainContext["image"]) {
  let text = raw.trim().slice(0, 4000);
  if (!text && !image) return;
  const { store } = d;
  const user = store.user(sender);
  const lower = text.toLowerCase().replace(/[.!]+$/, "").trim();
  const bare = lower.replace(/\?+$/, "").trim();
  const say = (...out: Out[]) => d.send(sender, out);

  if (/^(stop|unsubscribe|quit|leave me alone)$/.test(bare)) {
    store.saveUser({ ...user, muted: true, pending: [] });
    return say(t(copy.muted));
  }
  if (/^(forget me|delete me|delete my (data|ideas|stuff))$/.test(bare)) {
    store.forget(sender);
    d.changed?.();
    return say(t(copy.forgotten));
  }
  if (bare === "start" && user.muted) {
    store.saveUser({ ...user, muted: false });
    return say(t(copy.unmuted));
  }

  // An open intro question owns a short yes or no, and anything that is plainly about it.
  const top = user.pending.at(-1);
  const yn = yesNo(text);
  if (top?.kind === "intro") {
    if (yn) {
      user.pending.pop();
      if (yn.name && !user.name) user.name = yn.name;
      store.saveUser(user);
      return answerIntro(user, top.introId, yn.yes, d);
    }
    const intro = store.intro(top.introId);
    const theirs = store.idea((intro?.a === sender ? intro?.ideaB : intro?.ideaA) ?? "");
    if (ACK.test(bare)) return say(t(copy.introAck));
    if (/^(maybe|later|not yet|idk|i don'?t know|let me think|hm+)\b/.test(bare) && count(bare) <= 5) return say(t(copy.introLater));
    if (theirs && /^(who|what|which|tell me|more|details|whats|what's)\b/.test(bare) && count(bare) <= 8) {
      return say(t(`can't say who until they're in too. they're on "${theirs.title}" (${theirs.score}/100). yes or no?`));
    }
  }
  if (yn && !yn.name && !top) return say(t(copy.nothingOpen));

  // Reactions get no answer. Someone brand new still gets told what this is.
  if (!image && (ACK.test(bare) || EMOJI_ONLY.test(text))) {
    if (!store.ideasBy(sender).length) return say(t(copy.pitch));
    return /^(thanks|thank you|thx|ty)$/.test(bare) ? say(t(copy.thanks)) : undefined;
  }

  if (/^(mine|my ideas|list)$/.test(bare)) {
    const mine = store.ideasBy(sender);
    if (!mine.length) return say(t(copy.empty));
    return say(t(mine.map((i, n) => `${n + 1}. ${i.title}, ${i.score}${i.private ? " (private)" : ""}`).join("\n")));
  }

  // What it knows about you is one box of text. "me" reads it back, "me: ..." replaces it.
  if (/^(me|about me|what do you know about me)$/.test(bare)) {
    return say(t(user.facts.length ? `what i know: ${user.facts.join(". ")}.\ntext "me: ..." to replace it.` : copy.meEmpty));
  }
  const me = text.match(ABOUT_ME);
  if (me) {
    user.facts = [me[1].trim().slice(0, 400)];
    user.pending = user.pending.filter((p) => p.kind !== "ask");
    store.saveUser(user);
    if (!store.idea(user.lastIdea ?? "")) return say(t(copy.meSet));
    await say(t(copy.meSet));
    // Falls through: the new context re-reads their last idea.
  }

  if (/^(map|the map|show me the map)$/.test(bare)) {
    return say(t(d.mapUrl && !/localhost|127\.0\.0\.1/.test(d.mapUrl) ? d.mapUrl : copy.noMap));
  }
  // "why", "help", "?", "how do you score it", "how does the score work": the math, in one text.
  if (
    lower === "?" ||
    /^(why|how|help|commands|score|how (does|do) (this|it|you) work)$/.test(bare) ||
    (/^(how|why|what)\b.*\b(scor\w*|rated|rating|math)\b/.test(bare) && count(bare) <= 9)
  ) {
    return say(t(copy.how));
  }

  // "who's near me": only what the store knows. The model is never asked, so it can never make someone up.
  if (NEAR.test(bare) && count(bare) <= 8) {
    const idea = store.idea(user.lastIdea ?? "") ?? store.ideasBy(sender).at(-1);
    if (!idea) return say(t(copy.empty));
    if (idea.private) return say(t(copy.private));
    return offerIntro(idea, user, d);
  }

  if (DELETE.test(bare)) {
    const idea = store.idea(user.lastIdea ?? "") ?? store.ideasBy(sender).at(-1);
    if (!idea) return say(t(copy.noIdea));
    drop(idea, store.user(sender), d);
    return say(t(copy.gone));
  }

  const deck = bare.match(DECK);
  if (deck) {
    const mine = store.ideasBy(sender);
    const idea = deck[1] ? mine[Number(deck[1]) - 1] : (store.idea(user.lastIdea ?? "") ?? mine.at(-1));
    if (!idea) return say(t(copy.deckNone));
    await say(t(copy.deckMaking));
    return sendDeck(idea, sender, copy.deckHere, d);
  }

  const pic = bare.match(IMAGE);
  if (pic) {
    const mine = store.ideasBy(sender);
    const idea = pic[1] ? mine[Number(pic[1]) - 1] : (store.idea(user.lastIdea ?? "") ?? mine.at(-1));
    if (!idea) return say(t(copy.imageNone));
    await say(t(copy.imageMaking));
    return sendImage(idea, sender, d);
  }

  const vis = bare.match(/^(?:make it |keep it |go )?(public|private)(?:\s+#?(\d+))?$/);
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

  // "scratch that, new idea: ..." means it: the last idea goes, then the rest is read as the new one.
  if (SCRATCH.test(text) && count(text.replace(SCRATCH, "")) >= 3) {
    const gone = store.idea(user.lastIdea ?? "");
    if (gone) drop(gone, store.user(sender), d);
    text = text.replace(SCRATCH, "");
  }

  // Everything else goes to the brain: a new idea, more context on the last one, or small talk.
  const fresh = store.user(sender);
  Object.assign(user, { pending: fresh.pending, lastIdea: fresh.lastIdea });
  const last = store.idea(user.lastIdea ?? "");
  const openAsk = user.pending.at(-1)?.kind === "ask" ? (user.pending.at(-1) as { kind: "ask"; ideaId: string; question: string }) : undefined;
  let r: Read;
  try {
    r = await (d.brain ?? readBrain)(text.replace(PRIVATE, ""), {
      tree: store.tree(),
      facts: user.facts,
      last: last && { title: last.title, gist: last.gist, text: last.text, problem: last.problem, fix: last.fix },
      question: openAsk?.question,
      // One question, once: only while we know nothing about them. After that it never interviews.
      mayAsk: !openAsk && !user.facts.length && !user.askedOn,
      fresh: FRESH.test(text),
      image,
    });
    // An answer and a new idea in one text ("no. new idea: ...") is a new idea. It must never rewrite the old one.
    if (r.kind === "context" && FRESH.test(text) && !me) r.kind = "idea";
    if (me && last) r.kind = "context";
  } catch (err) {
    console.error(err);
    return say(t(copy.down));
  }

  if (r.fact && !user.facts.some((f) => f.toLowerCase() === r.fact.toLowerCase())) user.facts = [...user.facts, r.fact].slice(-8);

  if (r.kind === "chat" || (r.kind === "context" && !last)) {
    store.saveUser(user);
    if (r.kind === "chat" && r.reply) return say(t(r.reply));
    // Nothing worth saying back. Someone who has not sent an idea yet still gets told what this is.
    return store.ideasBy(sender).length ? undefined : say(t(copy.pitch));
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
  store.saveUser(user);
  d.changed?.();

  const out: Out[] = [];
  if (s >= 40) out.push({ type: "react", emoji: s >= 70 ? "love" : "like" });
  out.push(t(scoreLine(idea), s >= 80 ? "slam" : undefined));
  out.push(t(`${copy.call[call(s)]} ${r.verdict}${r.move ? `\nnext: ${r.move}` : ""}`));
  if (r.more) out.push(t(copy.more));
  if (idea.private) out.push(t(copy.private));
  // The score goes out first. Working out who is close happens while they are reading it.
  await say(...out);
  if (!idea.private) {
    await link(idea, d);
    d.changed?.();

    // A connection beats a question. The one question only gets asked when nobody is close yet,
    // and not when this same text already told us who they are.
    const mayAsk = r.ask && !r.fact && !user.facts.length && !user.askedOn;
    if (mayAsk && !closeTo(idea, user, store).length) {
      const question = copy.ask[r.ask as keyof typeof copy.ask];
      user.pending.push({ kind: "ask", ideaId: idea.id, question });
      user.askedOn = idea.id;
      store.saveUser(user);
      await say(t(question));
    } else await offerIntro(idea, store.user(sender), d);
  }
  // A 70 is a build. A build earns the picture and the deck, last, so the score and the connection land first.
  if (s >= 70) await sendBuild(idea, sender, copy.deckEarned, d);
}

/** A build: the product picture first, then the deck. The deck reuses the same picture, so it's one drawing, not two. */
async function sendBuild(idea: Idea, to: string, line: string, d: Deps) {
  await sendImage(idea, to, d);
  await sendDeck(idea, to, line, d);
}

/** Text the product picture. Over the daily cap or failing, one short line says so and the deck still goes. */
async function sendImage(idea: Idea, to: string, d: Deps) {
  let got: ImageResult;
  try {
    got = await (d.image ?? imageFor)(idea, d.store.user(to).facts);
  } catch (err) {
    console.error(`image failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    got = { miss: "fail" };
  }
  if ("miss" in got) return d.send(to, [t(got.miss === "cap" ? copy.imageCap : copy.imageDown)]);
  const ext = got.mimeType === "image/png" ? "png" : got.mimeType === "image/webp" ? "webp" : "jpg";
  await d.send(to, [{ type: "file", path: got.path, name: `${deckName(idea).replace(/ pitch deck\.pdf$/, "")}.${ext}`, mimeType: got.mimeType }]);
}

/** Make the deck and text it. A deck that fails says so; it never takes the conversation down with it. */
async function sendDeck(idea: Idea, to: string, line: string, d: Deps) {
  let path: string;
  try {
    path = await (d.deck ?? makeDeck)(idea, d.store.user(to).facts);
  } catch (err) {
    console.error(`deck failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    return d.send(to, [t(copy.deckDown)]);
  }
  await d.send(to, [t(line), { type: "file", path, name: deckName(idea), mimeType: "application/pdf" }]);
}

// New context landed (an answer to the one question, or more detail). Re-read the same idea in place.
async function addContext(user: User, idea: Idea, r: Read, d: Deps) {
  const { store } = d;
  const before = idea.score;
  const s = score(r.problem, r.fix);
  if (s !== before || r.problem !== idea.problem || r.fix !== idea.fix) {
    idea.was = [...(idea.was ?? []), { problem: idea.problem, fix: idea.fix, score: before, at: new Date().toISOString() }];
  }
  // New context moves the numbers and the advice. It never rewrites what the idea is (title, gist, branch).
  Object.assign(idea, { problem: r.problem, fix: r.fix, score: s, verdict: r.verdict, move: r.move });
  store.saveIdea(idea);
  user.pending = user.pending.filter((p) => p.kind !== "ask");
  store.saveUser(user);
  d.changed?.();

  // Only say the number again if it moved. Otherwise the new context pays off as plays, or not at all.
  const plays = r.plays.length ? `\n${r.plays.map((p, n) => `${n + 1}. ${p}`).join("\n")}` : "";
  const out: Out[] =
    s === before
      ? [t(plays ? `still ${s}/100. ${r.verdict}${plays}` : `still ${s}/100.`)]
      : [
          t(`${s}/100 now, was ${before}\nproblem ${idea.problem} · fix ${idea.fix}`, s >= 80 && s > before ? "slam" : undefined),
          t(`${copy.call[call(s)]} ${r.verdict}${plays || (r.move ? `\nnext: ${r.move}` : "")}`),
        ];
  await d.send(user.id, out);
  if (!idea.private && !store.intros().some((x) => x.ideaA === idea.id)) await offerIntro(idea, store.user(user.id), d);
  if (s >= 70 && before < 70) await sendBuild(idea, user.id, copy.deckEarnedNow, d);
}

/** Work out which other builders are on the same problem, once, and remember it on both ideas. */
async function link(idea: Idea, d: Deps) {
  const { store } = d;
  for (const c of candidates(idea, store)) {
    // Very close is close. In between, ask. If the question can't be asked, fall back to the stricter number.
    const same = c.sim >= SURE || ((await (d.judge ?? judgeBrain)(idea, c.idea)) ?? c.sim >= CLOSE);
    if (!same) continue;
    idea.near = [...new Set([...(idea.near ?? []), c.idea.id])];
    const other = store.idea(c.idea.id);
    if (other) store.saveIdea({ ...other, near: [...new Set([...(other.near ?? []), idea.id])] });
  }
  store.saveIdea(idea);
}

/** Take an idea off the books: the idea, its links, and any intro that was about it. */
function drop(idea: Idea, user: User, d: Deps) {
  const { store } = d;
  store.removeIdea(idea.id);
  const u = store.user(user.id);
  u.pending = u.pending.filter((p) => !(p.kind === "ask" && p.ideaId === idea.id));
  u.lastIdea = store.ideasBy(user.id).at(-1)?.id;
  if (u.askedOn === idea.id) u.askedOn = u.lastIdea ?? idea.id;
  store.saveUser(u);
  d.changed?.();
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
  const who = near.length === 1 ? `one builder's close. they're on "${pick.title}" (${pick.score}/100).` : `${near.length} builders are close. the closest is on "${pick.title}" (${pick.score}/100).`;
  await d.send(user.id, [t(`${who}\nwant an intro? i swap your numbers if they're in too. ${nameAsk(user)}`), ...fyi]);
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
