// "The builders closest to it." Closeness is the angle between two ideas' embeddings, so it works across
// branch names. With no embedding (offline, or the call failed) it falls back to sharing a branch.
import type { Idea, Store } from "./store.js";

export type Near = { idea: Idea; sim: number };

/** At or above this, two ideas are about the same problem. Measured on real pairs: related ones land at
 *  0.87-0.90, unrelated ones at 0.86 and under. Sharing a branch buys a little slack. */
export const CLOSE = Number(process.env.CLOSE ?? 0.87);
const SLACK = 0.03;

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const sameBranch = (a: Idea, b: Idea) => a.trunk === b.trunk && a.branch === b.branch;

export function similarity(a: Idea, b: Idea) {
  if (a.vec && b.vec && a.vec.length === b.vec.length) return dot(a.vec, b.vec);
  return sameBranch(a, b) ? CLOSE : 0;
}

export const close = (a: Idea, b: Idea) => similarity(a, b) >= (sameBranch(a, b) ? CLOSE - SLACK : CLOSE);

/** Other builders' closest idea each, nearest first. Never samples, never private ideas, never anyone who opted out. */
export function nearest(idea: Idea, store: Store): Near[] {
  const best = new Map<string, Near>();
  for (const o of store.mapIdeas()) {
    if (o.owner === idea.owner || o.sample || store.user(o.owner).muted || !close(idea, o)) continue;
    const sim = similarity(idea, o);
    const had = best.get(o.owner);
    if (!had || sim > had.sim) best.set(o.owner, { idea: o, sim });
  }
  return [...best.values()].sort((x, y) => y.sim - x.sim);
}
