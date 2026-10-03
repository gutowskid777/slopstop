// What the public map is allowed to know: titles, branches and scores. Never who, never the raw text.
import { CLOSE, similarity } from "./match.js";
import type { Idea, Store } from "./store.js";

export type MapIdea = { id: string; title: string; score: number; problem: number; fix: number; at: string; sample: boolean; near: number };

export function mapPayload(store: Store) {
  const ideas = store.mapIdeas();
  const real = ideas.filter((i) => !i.sample);
  const trunks = new Map<string, Map<string, MapIdea[]>>();
  for (const i of ideas) {
    const branches = trunks.get(i.trunk) ?? new Map<string, MapIdea[]>();
    const list = branches.get(i.branch) ?? [];
    list.push({ id: i.id, title: i.title, score: i.score, problem: i.problem, fix: i.fix, at: i.created, sample: Boolean(i.sample), near: neighbors(i, real) });
    branches.set(i.branch, list);
    trunks.set(i.trunk, branches);
  }
  const connected = store.intros().filter((x) => x.status === "connected");
  return {
    name: process.env.APP_NAME || "Bearing",
    ideas: real.length,
    builders: new Set(real.map((i) => i.owner)).size,
    connected: connected.length,
    latest: real.at(-1)?.id ?? null,
    // A line between two ideas whose builders said yes to each other.
    links: connected.map((x) => [x.ideaA, x.ideaB]).filter(([a, b]) => ideas.some((i) => i.id === a) && ideas.some((i) => i.id === b)),
    trunks: [...trunks].map(([name, branches]) => ({ name, branches: [...branches].map(([b, list]) => ({ name: b, ideas: list })) })),
  };
}

/** How many other builders sit close to this idea. */
const neighbors = (idea: Idea, real: Idea[]) =>
  new Set(real.filter((o) => o.owner !== idea.owner && similarity(idea, o) >= CLOSE).map((o) => o.owner)).size;
