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
import { Mirror } from "./mirror.js";

const mapOnly = process.argv.includes("--map-only");
const mapUrl = process.env.MAP_URL;
const store = new JsonStore();
let agent: Awaited<ReturnType<typeof startAgent>> | undefined;
let lineUp = false;
const started = new Date().toISOString();

// On the server the data also lives in Firestore. A fresh machine restores from it before the port opens.
const mirror = process.env.FIRESTORE_PROJECT ? new Mirror(store) : undefined;
await mirror?.boot();

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

const status = () => ({
  version: process.env.APP_VERSION ?? "dev",
  started,
  line: mapOnly ? "off" : lineUp ? "up" : "down",
  answers: process.env.ONLY_FROM ? "test numbers only" : process.env.IGNORE_FROM ? "everyone but the test numbers" : "everyone",
  ideas: store.mapIdeas().filter((i) => !i.sample).length,
  firestore: mirror ? mirror.status : "off",
});

// /me sign-in codes go out on the same iMessage line. The code itself never reaches the log or /admin.
const sendCode = async (to: string, text: string) => {
  if (!agent || !reachable(to)) throw new Error("the agent is off");
  await agent.direct(to, [{ type: "text", text }], "[sign-in code]");
};

const web = startServer({ store, port: Number(process.env.PORT ?? 1290), play, ping, status, sendCode });

// The port is the lock: only connect to the line once we know we are the only copy running.
await web.ready;

if (!brainOnline()) console.log("no GEMINI_API_KEY: running the offline stub brain");

if (mapOnly || !photonOnline()) {
  if (!mapOnly) console.log("no Photon keys in .env: map only, the iMessage agent is off");
} else {
  let stopping = false;
  const stop = async () => {
    stopping = true;
    await agent?.stop();
    // The last write reaches Firestore before the process goes.
    await Promise.race([mirror?.settle(), new Promise((r) => setTimeout(r, 8_000))]);
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Keep a line open for as long as this process lives. Venue wifi drops; a dead stream gets a fresh connection.
  for (let restarts = 0; !stopping; restarts++) {
    try {
      agent = await startAgent({ store, mapUrl, changed: web.broadcast, offline });
      lineUp = true;
      console.log(`agent up on Photon project "${agent.name}", waiting for texts${restarts ? ` (reconnect ${restarts})` : ""}`);
      await agent.done;
      lineUp = false;
      await agent.stop().catch(() => {});
    } catch (err) {
      console.error(`agent could not connect: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
    if (!stopping) await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * (restarts + 1))));
  }
}
