// One process: the iMessage agent and the map share one store, so a text shows up on the map the moment it is scored.
// npm start            agent + map
// npm run map          map only (no iMessage; pair it with `npm run try`)
import "dotenv/config";
import { reachable, startAgent } from "./agent.js";
import { online as brainOnline } from "./brain.js";
import { handle, type Out } from "./core.js";
import { online as photonOnline } from "./photon.js";
import { startServer, type Line } from "./server.js";
import { JsonStore } from "./store.js";

const mapOnly = process.argv.includes("--map-only");
const mapUrl = process.env.MAP_URL;
const store = new JsonStore();
let agent: Awaited<ReturnType<typeof startAgent>> | undefined;

// `npm run try` lands here when this process is up: a builder played from the terminal, inside the live
// process. Real phones still get real iMessages; the played builder's side comes back as a transcript.
let transcript: Line[] | undefined;
const offline = (to: string, out: Out[]) => void transcript?.push({ to, out });
let turn = Promise.resolve<Line[]>([]);
const play = (from: string, text: string) =>
  (turn = turn
    .catch(() => [])
    .then(async () => {
      const lines: Line[] = (transcript = []);
      try {
        await handle(from, text, {
          store,
          mapUrl,
          changed: web.broadcast,
          send: async (to, out) => (agent && reachable(to) ? agent.direct(to, out) : offline(to, out)),
        });
      } finally {
        transcript = undefined;
      }
      return lines;
    }));

const ping = async (to: string, text: string) => {
  if (!agent || !reachable(to)) throw new Error("the agent is off, or that is not a real number");
  await agent.direct(to, [{ type: "text", text }]);
};

const web = startServer({ store, port: Number(process.env.PORT ?? 1290), play, ping });

if (!brainOnline()) console.log("no GEMINI_API_KEY: running the offline stub brain");

if (mapOnly || !photonOnline()) {
  if (!mapOnly) console.log("no Photon keys in .env: map only, the iMessage agent is off");
} else {
  agent = await startAgent({ store, mapUrl, changed: web.broadcast, offline });
  console.log(`agent up on Photon project "${agent.name}", waiting for texts`);
  const stop = async () => {
    await agent?.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
