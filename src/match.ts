// "The builders closest to it." Closeness is the angle between two ideas' embeddings, so it works across
// branch names. With no embedding (offline, or the call failed) it falls back to sharing a branch.
import type { Idea, Store } from "./store.js";

export type Near = { idea: Idea; sim: number };

/** At or above this, two ideas are close enough to be worth an intro. */
export const CLOSE = Number(process.env.CLOSE ?? 0.8);

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export function similarity(a: Idea, b: Idea) {
  if (a.vec && b.vec && a.vec.length === b.vec.length) return dot(a.vec, b.vec);
  if (a.trunk === b.trunk && a.branch === b.branch) return CLOSE;
  return 0;
}

/** Other builders' closest idea each, nearest first. Never samples, never private ideas, never anyone who opted out. */
export function nearest(idea: Idea, store: Store): Near[] {
  const best = new Map<string, Near>();
  for (const o of store.mapIdeas()) {
    if (o.owner === idea.owner || o.sample || store.user(o.owner).muted) continue;
    const sim = similarity(idea, o);
    if (sim < CLOSE) continue;
    const had = best.get(o.owner);
    if (!had || sim > had.sim) best.set(o.owner, { idea: o, sim });
  }
  return [...best.values()].sort((x, y) => y.sim - x.sim);
}
