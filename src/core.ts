// One inbound text in, replies out. Transport-free so the iMessage agent and the CLI share it.
import { analyze, type Analysis, type BrainContext } from "./brain.js";
import { newId, type Idea, type Intro, type Store, type User } from "./store.js";

export type Deps = {
  store: Store;
  reply: (text: string) => Promise<void>;
  sendTo: (userId: string, text: string) => Promise<void>;
  brain?: (text: string, ctx: BrainContext) => Promise<Analysis>;
  mapUrl?: string;
};

const YES = /^(y|yes|yep|yeah|sure|ok|okay|do it)\b/i;
const NO = /^(n|no|nope|nah|pass)\b/i;

export const ratio = (i: Pick<Idea, "problemPain" | "solutionPain">) => `${i.problemPain}:${i.solutionPain}`;

export async function handle(sender: string, raw: string, d: Deps) {
  const text = raw.trim();
  if (!text) return;
  const { store } = d;
  const user = store.user(sender);
  const lower = text.toLowerCase();

  // A pending yes/no question wins over everything else.
  const pending = user.pending.at(-1);
  if (pending && (YES.test(text) || NO.test(text))) {
    user.pending.pop();
    store.saveUser(user);
    const yes = YES.test(text);
    if (pending.kind === "public") return answerPublic(user, pending.ideaId, yes, d);
    return answerIntro(user, pending.introId, yes, d);
  }
  if (!pending && (YES.test(text) || NO.test(text)) && text.split(/\s+/).length <= 2) {
    return d.reply("Nothing to answer right now. Text me an idea.");
  }

  if (lower === "map") return d.reply(`The map: ${d.mapUrl ?? "not live yet"}`);

  if (lower === "mine") {
    const mine = store.ideasBy(sender);
    if (!mine.length) return d.reply("Nothing yet. Text me an idea, any idea.");
    return d.reply(
      mine.map((i, n) => `${n + 1}. ${i.title} (${ratio(i)}, ${i.public ? "public" : "private"})`).join("\n"),
    );
  }

  const vis = lower.match(/^(public|private)\s+(\d+)$/);
  if (vis) {
    const idea = store.ideasBy(sender)[Number(vis[2]) - 1];
    if (!idea) return d.reply("No idea with that number. Text \"mine\" to see the list.");
    idea.public = vis[1] === "public";
    store.saveIdea(idea);
    await d.reply(`${idea.title} is ${vis[1]} now.`);
    if (idea.public) await findOverlap(idea, d);
    return;
  }

  const about = text.match(/^about me[:\s]+(.+)$/is);
  if (about) {
    user.about = about[1].trim();
    store.saveUser(user);
    return d.reply("Got it. I'll use that when I read your ideas.");
  }

  if (lower === "help" || lower === "?") {
    return d.reply(
      "Text me any idea and I'll score it. Also: \"mine\", \"map\", \"public 2\", \"private 2\", \"about me: ...\"",
    );
  }

  // Everything else is a new idea.
  const brain = d.brain ?? analyze;
  const a = await brain(text, { branches: store.branches(), about: user.about });
  const idea: Idea = {
    id: newId(),
    owner: sender,
    text,
    ...a,
    public: false,
    created: new Date().toISOString(),
  };
  store.addIdea(idea);
  await d.reply(`${idea.title}, filed under ${idea.branch}.\nPain ratio ${ratio(idea)}. ${idea.verdict}\nNext: ${idea.nextAction}`);
  const fresh = store.user(sender);
  fresh.pending.push({ kind: "public", ideaId: idea.id });
  store.saveUser(fresh);
  await d.reply("Put it on the public map? yes / no");
}

async function answerPublic(user: User, ideaId: string, yes: boolean, d: Deps) {
  const idea = d.store.idea(ideaId);
  if (!idea) return;
  if (!yes) return d.reply("Kept private. Only you can see it.");
  idea.public = true;
  d.store.saveIdea(idea);
  await d.reply(`On the map under ${idea.branch}.`);
  await findOverlap(idea, d);
}

// A public idea landing on a branch someone else is already on = an intro offer to both.
async function findOverlap(idea: Idea, d: Deps) {
  const { store } = d;
  const near = store
    .publicIdeas()
    .filter((o) => o.branch === idea.branch && o.owner !== idea.owner && !store.introBetween(o.owner, idea.owner))
    .at(-1);
  if (!near) return;
  const intro: Intro = { id: newId(), a: idea.owner, b: near.owner, ideaA: idea.id, ideaB: near.id, status: "asked" };
  store.addIntro(intro);
  for (const [who, mine] of [
    [idea.owner, idea],
    [near.owner, near],
  ] as const) {
    const u = store.user(who);
    u.pending.push({ kind: "intro", introId: intro.id });
    store.saveUser(u);
    const line = `Someone's near your idea ${mine.title}. Want an intro? yes / no`;
    if (who === idea.owner) await d.reply(line);
    else await d.sendTo(who, line);
  }
}

async function answerIntro(user: User, introId: string, yes: boolean, d: Deps) {
  const { store } = d;
  const intro = store.intro(introId);
  if (!intro || intro.status !== "asked") return;
  if (intro.a === user.id) intro.aYes = yes;
  else intro.bYes = yes;
  if (!yes) {
    intro.status = "declined";
    store.saveIntro(intro);
    return d.reply("No intro. Nobody gets told you passed.");
  }
  if (intro.aYes && intro.bYes) {
    intro.status = "connected";
    store.saveIntro(intro);
    const ia = store.idea(intro.ideaA);
    const ib = store.idea(intro.ideaB);
    await d.sendTo(intro.a, `Connected. Text ${intro.b}, they're building ${ib?.title ?? "something close"}.`);
    await d.sendTo(intro.b, `Connected. Text ${intro.a}, they're building ${ia?.title ?? "something close"}.`);
    return;
  }
  store.saveIntro(intro);
  await d.reply("Asked them too. I'll connect you if they say yes.");
}
