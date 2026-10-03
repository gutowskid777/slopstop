// The whole conversation from the terminal, no phone needed. Same core, same brain, same store.
// npm run try -- "my idea"             (as "you")
// FROM=alex npm run try -- "yes alex"  (as someone else, to play out an intro)
// If `npm start` is running, this plays inside it: the map updates live, and anyone in the conversation
// with a real number gets a real iMessage.
import "dotenv/config";
import { handle, type Out } from "./core.js";
import { JsonStore } from "./store.js";

const text = process.argv.slice(2).join(" ");
if (!text) {
  console.log('usage: npm run try -- "your idea"   (FROM=alex to be someone else)');
  process.exit(1);
}
const sender = process.env.FROM ?? "you";
const show = (o: Out) =>
  o.type === "text"
    ? o.text + (o.effect ? `   [${o.effect}]` : "")
    : o.type === "react"
      ? `[tapback: ${o.emoji}]`
      : `[contact card: ${o.name}, ${o.handle}. ${o.note}]`;
const print = (to: string, out: Out[]) => {
  console.log(`\n--- to ${to}`);
  for (const o of out) console.log(show(o) + "\n");
};

const live = await fetch(`http://localhost:${process.env.PORT ?? 1290}/api/dev/text`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ from: sender, text }),
}).catch(() => undefined);

if (live?.ok) {
  const { lines } = (await live.json()) as { lines: { to: string; out: Out[] }[] };
  for (const l of lines) print(l.to, l.out);
  if (!lines.length) console.log("\n(nothing came back to the terminal: any replies went to real phones)");
} else {
  await handle(sender, text, { store: new JsonStore(), mapUrl: process.env.MAP_URL, send: async (to, out) => print(to, out) });
}
