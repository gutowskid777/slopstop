// Run the brain + store path from the terminal, no iMessage needed.
// npm run try -- "my idea"            (as "you")
// FROM=alex npm run try -- "yes"      (as someone else)
import "dotenv/config";
import { handle } from "./core.js";
import { JsonStore } from "./store.js";

const text = process.argv.slice(2).join(" ");
if (!text) {
  console.log('usage: npm run try -- "your idea"');
  process.exit(1);
}
const sender = process.env.FROM ?? "you";
const store = new JsonStore();
await handle(sender, text, {
  store,
  mapUrl: process.env.MAP_URL ?? "http://localhost:1290",
  reply: async (t) => console.log(`\n[to ${sender}]\n${t}`),
  sendTo: async (to, t) => console.log(`\n[to ${to}]\n${t}`),
});
