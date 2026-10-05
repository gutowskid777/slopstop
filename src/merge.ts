// The cutover. While the server was being proven, the laptop kept answering everyone except the test numbers, and the
// server answered only them. This folds the laptop's file into the server's: everything from the laptop, except the
// test numbers' people, ideas and intros, which come from the server.
// Run on the server with the service stopped:  tsx src/merge.ts <laptop db.json> <handle>[,<handle>...] [extra messages.json]
import { readFileSync } from "node:fs";
import { JsonStore, type Db, type Msg } from "./store.js";

export function merge(laptop: Db, server: Readonly<Db>, keep: Set<string>, extra: Msg[] = []): Db {
  const ours = (owner: string) => keep.has(owner);
  const users = Object.fromEntries(Object.entries(laptop.users).filter(([id]) => !ours(id)));
  for (const id of keep) if (server.users[id]) users[id] = server.users[id];
  const ideas = [...laptop.ideas.filter((i) => !ours(i.owner)), ...server.ideas.filter((i) => ours(i.owner))];
  const intros = laptop.intros.filter((x) => !ours(x.a) && !ours(x.b));
  intros.push(...server.intros.filter((x) => ours(x.a) || ours(x.b)));
  // A link to an idea that didn't make it across goes too.
  const ids = new Set(ideas.map((i) => i.id));
  for (const i of ideas) if (i.near) i.near = i.near.filter((n) => ids.has(n));
  // Messages are a log of what each copy really heard and said, so both sides are kept (plus any read back from the
  // server's own log). A text both copies heard is kept once.
  const byId = new Map([...(laptop.messages ?? []), ...(server.messages ?? []), ...extra].map((m) => [m.id, m]));
  const sorted = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const messages = sorted.filter((m, n) => m.dir === "out" || !sorted.slice(0, n).some((p) => p.dir === "in" && p.who === m.who && p.text === m.text && Date.parse(m.at) - Date.parse(p.at) <= 10_000));
  return { users, ideas, intros, messages };
}

if (process.argv[1]?.endsWith("merge.ts")) {
  const [file, list, more] = process.argv.slice(2);
  if (!file || !list) {
    console.log("usage: tsx src/merge.ts <laptop db.json> <handle>[,<handle>...]");
    process.exit(1);
  }
  const store = new JsonStore();
  const before = store.dump();
  const laptop = JSON.parse(readFileSync(file, "utf8")) as Db;
  const extra = more ? (JSON.parse(readFileSync(more, "utf8")) as Msg[]) : [];
  const next = merge(laptop, before, new Set(list.split(",").map((h) => h.trim()).filter(Boolean)), extra);
  console.log(`server had ${before.ideas.length} ideas / ${Object.keys(before.users).length} people; laptop ${laptop.ideas.length} / ${Object.keys(laptop.users).length}`);
  store.replace(next);
  console.log(`merged: ${next.ideas.length} ideas, ${Object.keys(next.users).length} people, ${next.intros.length} intros, ${next.messages.length} messages`);
}
