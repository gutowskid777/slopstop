// The iMessage side. Photon Spectrum's managed cloud line: no Mac relay, no phone number of our own.
// This file only moves messages; what to say lives in core.ts.
import { Spectrum, Emoji, contact, type Message, type Space } from "spectrum-ts";
import { imessage, effect } from "spectrum-ts/providers/imessage";
import { handle, type Deps, type Out } from "./core.js";
import type { BrainContext } from "./brain.js";
import type { JsonStore } from "./store.js";

/** People text in bursts ("hey" / "wait" / the actual idea). Wait this long for the burst to settle. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1100);
/** Gap between our own bubbles, so a reply reads like a person and not a dump. */
const PACE_MS = Number(process.env.PACE_MS ?? 700);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const mask = (h: string) => (h.length > 6 ? `${h.slice(0, 3)}…${h.slice(-4)}` : h);
const quiet = (what: string) => (err: unknown) => console.error(`${stamp()} ${what}: ${String((err as Error)?.message ?? err).slice(0, 200)}`);

type Lane = { texts: string[]; image?: BrainContext["image"]; space: Space; last: Message; timer?: NodeJS.Timeout; busy: boolean };

/** A handle a real iMessage can reach. Anything else ("alex") is a builder being played from the terminal. */
export const reachable = (handle: string) => /^\+\d{7,15}$/.test(handle) || handle.includes("@");

export async function startAgent(opts: {
  store: JsonStore;
  mapUrl?: string;
  changed?: () => void;
  /** Where messages for terminal-played builders go instead of a phone. */
  offline?: (to: string, out: Out[]) => void;
}) {
  const app = await Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID!,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
    providers: [imessage.config()],
    // A text with a photo arrives as a bundle. Take the parts one at a time.
    options: { flattenGroups: true, logLevel: "warn" },
  });
  const im = imessage(app);
  const lanes = new Map<string, Lane>();
  const seen = new Set<string>();

  // Turn what the core wants to say into real iMessage: bubbles, tapbacks, effects, a contact card.
  const deliver = async (space: Space, out: Out[], last?: Message) => {
    let sent = 0;
    for (const o of out) {
      if (o.type === "react") {
        await last?.react(o.emoji === "love" ? Emoji.love : Emoji.like).catch(quiet("tapback"));
        continue;
      }
      if (sent++) {
        await space.startTyping().catch(() => {});
        await pause(PACE_MS);
      }
      if (o.type === "contact") {
        const [first, ...rest] = o.name.split(" ");
        // A terminal-played builder has no number. The card still lands, on a line that can't ring anyone.
        const handle = reachable(o.handle) ? o.handle : "+16075550134";
        const reach = handle.includes("@") ? { emails: [{ value: handle }] } : { phones: [{ value: handle, type: "mobile" as const }] };
        await space.send(contact({ name: { first, last: rest.join(" ") || undefined, formatted: o.name }, note: o.note, ...reach }));
        continue;
      }
      const fx = o.effect === "slam" ? imessage.effect.message.slam : o.effect === "confetti" ? imessage.effect.message.confetti : undefined;
      // An effect is a nice-to-have. If the line refuses it, the words still have to land.
      if (fx) await space.send(effect(o.text, fx)).catch(() => space.send(o.text));
      else await space.send(o.text);
    }
  };

  /** Message someone on their own thread with the agent, whoever started the turn. */
  const direct = async (to: string, out: Out[]) => {
    for (const o of out) console.log(`${stamp()} -> ${mask(to)}: ${o.type === "text" ? o.text.replace(/\n/g, " / ") : `[${o.type}]`}`);
    if (!reachable(to)) return opts.offline?.(to, out);
    const dm = await im.space.create(await im.user(to));
    await deliver(dm, out);
  };

  const depsFor = (sender: string, space: Space, last: Message): Deps => ({
    store: opts.store,
    mapUrl: opts.mapUrl,
    changed: opts.changed,
    send: async (to, out) => {
      if (to !== sender) return direct(to, out);
      for (const o of out) console.log(`${stamp()} -> ${mask(to)}: ${o.type === "text" ? o.text.replace(/\n/g, " / ") : `[${o.type}]`}`);
      await deliver(space, out, last);
    },
  });

  const flush = async (sender: string) => {
    const lane = lanes.get(sender);
    if (!lane || lane.busy || (!lane.texts.length && !lane.image)) return;
    lane.busy = true;
    const text = lane.texts.splice(0).join("\n");
    const image = lane.image;
    lane.image = undefined;
    const { space, last } = lane;
    try {
      opts.store.reload();
      await space.responding(() => handle(sender, text, depsFor(sender, space, last), image));
    } catch (err) {
      quiet("turn failed")(err);
      await space.send("something broke on my end. text that again in a min.").catch(quiet("apology"));
    } finally {
      lane.busy = false;
      // Anything they sent while we were answering becomes the next turn.
      if (lane.texts.length || lane.image) void flush(sender);
    }
  };

  const queue = (sender: string, space: Space, message: Message, text: string, image?: BrainContext["image"]) => {
    const lane = lanes.get(sender) ?? { texts: [], space, last: message, busy: false };
    lanes.set(sender, lane);
    if (text) lane.texts.push(text);
    if (image) lane.image = image;
    lane.space = space;
    lane.last = message;
    message.read().catch(() => {});
    space.startTyping().catch(() => {});
    clearTimeout(lane.timer);
    lane.timer = setTimeout(() => void flush(sender), SETTLE_MS);
  };

  const loop = (async () => {
    for await (const [space, message] of app.messages) {
      try {
        if (message.platform !== "imessage" || message.direction !== "inbound") continue;
        // Delivery is at-least-once. Never answer the same message twice.
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
        const sender = message.sender?.id;
        if (!sender || imessage(space).type === "group") continue;
        const c = message.content;
        if (c.type === "text") {
          console.log(`${stamp()} <- ${mask(sender)}: ${c.text.replace(/\n/g, " / ")}`);
          queue(sender, space, message, c.text);
        } else if (c.type === "attachment" && c.mimeType.startsWith("image/")) {
          // A photo of a whiteboard or a sketch is an idea too.
          console.log(`${stamp()} <- ${mask(sender)}: [photo ${c.mimeType}]`);
          queue(sender, space, message, "", { mimeType: c.mimeType, data: await c.read() });
        } else if (c.type === "reaction") {
          // A thumbs-up or heart on the intro question is a yes. A thumbs-down is a no.
          const yes = c.emoji === Emoji.love || c.emoji === Emoji.like;
          const no = c.emoji === Emoji.dislike;
          const top = opts.store.user(sender).pending.at(-1);
          if ((yes || no) && top?.kind === "intro") {
            console.log(`${stamp()} <- ${mask(sender)}: [tapback ${c.emoji}]`);
            queue(sender, space, message, yes ? "yes" : "no");
          }
        }
      } catch (err) {
        quiet("inbound failed")(err);
      }
    }
  })();
  loop.catch(quiet("message stream ended"));

  return { stop: () => app.stop(), name: app.config.name, direct };
}
