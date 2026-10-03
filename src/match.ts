// "The builders closest to it." Two steps. The angle between two ideas' embeddings finds candidates; then a
// yes/no read decides whether they are really on the same problem. Sharing an audience ("for students") or a
// format ("a text bot") scores high on angle alone, which is how a laundry tracker once got matched to a notes app.
import type { Idea, Store } from "./store.js";

export type Near = { idea: Idea; sim: number };

/** Worth asking about. Measured on real pairs: unrelated ideas for the same audience land at 0.84-0.89. */
export const CANDIDATE = Number(process.env.CANDIDATE ?? 0.86);
/** Close enough on its own when the question can't be asked. */
export const CLOSE = Number(process.env.CLOSE ?? 0.915);
/** So close there is nothing to ask. The same idea in different words lands at 0.93-0.96. */
export const SURE = Number(process.env.SURE ?? 0.94);

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const sameBranch = (a: Idea, b: Idea) => a.trunk === b.trunk && a.branch === b.branch;

/** With no embedding (offline, or the call failed), sharing a branch is the only signal there is. */
export function similarity(a: Idea, b: Idea) {
  if (a.vec && b.vec && a.vec.length === b.vec.length) return dot(a.vec, b.vec);
  return sameBranch(a, b) ? CLOSE : 0;
}

const reachable = (idea: Idea, o: Idea, store: Store) => o.owner !== idea.owner && !o.sample && !o.private && !store.user(o.owner).muted;

const bestPerOwner = (list: Near[]) => {
  const best = new Map<string, Near>();
  for (const n of list) if (!best.has(n.idea.owner) || n.sim > best.get(n.idea.owner)!.sim) best.set(n.idea.owner, n);
  return [...best.values()].sort((x, y) => y.sim - x.sim);
};

/** Other builders' ideas worth a closer look, nearest first. A few at most: each one costs a question. */
export function candidates(idea: Idea, store: Store): Near[] {
  const list = store
    .mapIdeas()
    .filter((o) => reachable(idea, o, store))
    .map((o) => ({ idea: o, sim: similarity(idea, o) }))
    .filter((n) => n.sim >= CANDIDATE);
  return bestPerOwner(list).slice(0, 3);
}

/** The builders already judged to be on the same problem, nearest first. Never samples, private ideas, or anyone who opted out. */
export function nearest(idea: Idea, store: Store): Near[] {
  const list = (idea.near ?? [])
    .map((id) => store.idea(id))
    .filter((o): o is Idea => Boolean(o) && reachable(idea, o!, store))
    .map((o) => ({ idea: o, sim: similarity(idea, o) }));
  return bestPerOwner(list);
}
