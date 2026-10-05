// One-off: the hackathon's threads only ever went to data/agent.log, before the store kept messages. This reads them
// back in so /admin has them. The log has times but no dates and masked numbers (+16…1360), so: the log began on
// FIRST_DAY, a clock that jumps back means the next day, and a mask is matched to the one known person it fits.
// Run with the agent stopped (it writes the same file):  tsx src/backfill.ts [log] [first day YYYY-MM-DD] [utc offset]
import { readFileSync } from "node:fs";
import { JsonStore, msgId, type Msg } from "./store.js";

export function parseLog(log: string, firstDay: string, offset: string, people: string[]): Msg[] {
  const byMask = new Map<string, string[]>();
  for (const h of people) {
    const m = h.length > 6 ? `${h.slice(0, 3)}…${h.slice(-4)}` : h;
    byMask.set(m, [...(byMask.get(m) ?? []), h]);
  }
  const out: Msg[] = [];
  let day = new Date(`${firstDay}T00:00:00${offset}`);
  let prev = -1;
  for (const line of log.split("\n")) {
    const m = line.match(/^(\d\d):(\d\d):(\d\d) (->|<-) ([^:]+): (.*)$/);
    if (!m) continue;
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    // Lines can land a few seconds out of order; a jump back of hours is midnight.
    if (prev >= 0 && secs < prev - 3 * 3600) day = new Date(day.getTime() + 86_400_000);
    prev = secs;
    const at = new Date(day.getTime() + secs * 1000);
    const who = byMask.get(m[5])?.length === 1 ? byMask.get(m[5])![0] : m[5];
    out.push({ id: msgId(at.getTime()), who, dir: m[4] === "<-" ? "in" : "out", text: m[6].replace(/ \/ /g, "\n"), at: at.toISOString() });
  }
  return out;
}

if (process.argv[1]?.endsWith("backfill.ts")) {
  const [file = "data/agent.log", firstDay = "2026-10-03", offset = "-04:00"] = process.argv.slice(2);
  const store = new JsonStore();
  if (store.messages().length) {
    console.log(`the store already has ${store.messages().length} messages; nothing imported (run this once, before the agent keeps its own)`);
    process.exit(1);
  }
  const db = store.dump();
  const people = [...new Set([...Object.keys(db.users), ...db.ideas.filter((i) => !i.sample).map((i) => i.owner)])];
  const msgs = parseLog(readFileSync(file, "utf8"), firstDay, offset, people);
  store.replace({ ...db, messages: msgs });
  const unmatched = new Set(msgs.filter((m) => !m.who.startsWith("+") || m.who.includes("…")).map((m) => m.who));
  console.log(`imported ${msgs.length} messages from ${new Set(msgs.map((m) => m.who)).size} people${unmatched.size ? `; kept masked: ${[...unmatched].join(", ")}` : ""}`);
}
