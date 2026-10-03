// The iMessage agent. Photon Spectrum managed cloud: no Mac, no phone number of our own.
import "dotenv/config";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { handle } from "./core.js";
import { JsonStore } from "./store.js";

const app = await Spectrum({
  projectId: process.env.SPECTRUM_PROJECT_ID!,
  projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
  providers: [imessage.config()],
});
const im = imessage(app);
const store = new JsonStore();
console.log("agent up, waiting for texts");

for await (const [space, message] of app.messages) {
  if (message.direction !== "inbound" || message.content.type !== "text") continue;
  const sender = message.sender?.id;
  if (!sender) continue;
  const text = message.content.text;
  console.log(`<- ${sender}: ${text}`);
  store.reload();
  try {
    await app.responding(space, () =>
      handle(sender, text, {
        store,
        mapUrl: process.env.MAP_URL,
        reply: async (t) => {
          console.log(`-> ${sender}: ${t}`);
          await space.send(t);
        },
        sendTo: async (to, t) => {
          console.log(`-> ${to}: ${t}`);
          const dm = await im.space.create(to);
          await dm.send(t);
        },
      }),
    );
  } catch (err) {
    console.error(err);
    await space.send("Something broke on my end. Try that again in a minute.");
  }
}
