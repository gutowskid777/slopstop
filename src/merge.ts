// The cutover. While the server was being proven, the laptop kept answering everyone except the test numbers, and the
// server answered only them. This folds the laptop's file into the server's: everything from the laptop, except the
// test numbers' people, ideas and intros, which come from the server.
// Run on the server with the service stopped:  tsx src/merge.ts <laptop db.json> <handle>[,<handle>...]
import { readFileSync } from "node:fs";
import { JsonStore, type Db } from "./store.js";

export function merge(laptop: Db, server: Readonly<Db>, keep: Set<string>): Db {
  const ours = (owner: string) => keep.has(owner);
  const users = Object.fromEntries(Object.entries(laptop.users).filter(([id]) => !ours(id)));
  for (const id of keep) if (server.users[id]) users[id] = server.users[id];
  const ideas = [...laptop.ideas.filter((i) => !ours(i.owner)), ...server.ideas.filter((i) => ours(i.owner))];
  const intros = laptop.intros.filter((x) => !ours(x.a) && !ours(x.b));
  intros.push(...server.intros.filter((x) => ours(x.a) || ours(x.b)));
  // A link to an idea that didn't make it across goes too.
  const ids = new Set(ideas.map((i) => i.id));
  for (const i of ideas) if (i.near) i.near = i.near.filter((n) => ids.has(n));
  // Each side's conversations, by the same split, back in time order.
  const messages = [...(laptop.messages ?? []).filter((m) => !ours(m.who)), ...(server.messages ?? []).filter((m) => ours(m.who))];
  messages.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { users, ideas, intros, messages };
}

if (process.argv[1]?.endsWith("merge.ts")) {
  const [file, list] = process.argv.slice(2);
  if (!file || !list) {
    console.log("usage: tsx src/merge.ts <laptop db.json> <handle>[,<handle>...]");
    process.exit(1);
  }
  const store = new JsonStore();
  const before = store.dump();
  const laptop = JSON.parse(readFileSync(file, "utf8")) as Db;
  const next = merge(laptop, before, new Set(list.split(",").map((h) => h.trim()).filter(Boolean)));
  console.log(`server had ${before.ideas.length} ideas / ${Object.keys(before.users).length} people; laptop ${laptop.ideas.length} / ${Object.keys(laptop.users).length}`);
  store.replace(next);
  console.log(`merged: ${next.ideas.length} ideas, ${Object.keys(next.users).length} people, ${next.intros.length} intros`);
}
