// The public map payload. Titles, branches and ratios only: never owners or handles.
import type { Store } from "./store.js";

export function mapPayload(store: Store) {
  const ideas = store.publicIdeas();
  const byBranch = new Map<string, { name: string; parent?: string; ideas: object[] }>();
  for (const i of ideas) {
    const b = byBranch.get(i.branch) ?? { name: i.branch, parent: i.parent, ideas: [] };
    b.ideas.push({ id: i.id, title: i.title, problemPain: i.problemPain, solutionPain: i.solutionPain });
    byBranch.set(i.branch, b);
  }
  return { count: ideas.length, branches: [...byBranch.values()] };
}
