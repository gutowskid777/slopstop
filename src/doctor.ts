// "Is everything wired?" in plain English. Run it before a demo: npm run doctor
import "dotenv/config";
import { read, embed, online as brainOnline } from "./brain.js";
import { score } from "./score.js";
import { listUsers, getProfile, online as photonOnline } from "./photon.js";

const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => console.log(`  FIX   ${m}`);
const mask = (h: string) => `${h.slice(0, 5)}…${h.slice(-2)}`;

console.log("\nBrain (Gemini)");
if (!brainOnline()) bad("no GEMINI_API_KEY in .env, so scores come from the offline stub");
else {
  try {
    const t = Date.now();
    const r = await read("a text line that reminds freelancers to send invoices and chases late payments", { tree: [], facts: [], mayAsk: false });
    ok(`scored a test idea in ${((Date.now() - t) / 1000).toFixed(1)}s: "${r.title}" ${score(r.problem, r.fix)}/100 (problem ${r.problem}, fix ${r.fix})`);
  } catch (err) {
    bad(`scoring failed: ${String((err as Error).message).slice(0, 140)}`);
  }
  (await embed("test")) ? ok("matching (embeddings) works") : bad("embeddings failed, matching falls back to same-branch only");
}

console.log("\niMessage line (Photon)");
if (!photonOnline()) bad("no SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET in .env");
else {
  try {
    const profile = await getProfile();
    profile.firstName ? ok(`the agent shows up in Messages as "${[profile.firstName, profile.lastName].filter(Boolean).join(" ")}"`) : bad("the agent has no name in Messages yet");
    const users = await listUsers();
    ok(`${users.length} ${users.length === 1 ? "person is" : "people are"} registered to text it`);
    for (const u of users) console.log(`        ${mask(u.phoneNumber)} texts ${u.assignedPhoneNumber}`);
    if (!users.length) bad("nobody can text it yet: open the map and use Text it, or add yourself in the Photon dashboard");
  } catch (err) {
    bad(`Photon check failed: ${String((err as Error).message).slice(0, 140)}`);
  }
}

console.log("\nMap");
const url = process.env.MAP_URL ?? "";
/localhost|127\.0\.0\.1/.test(url) || !url ? ok(`local only (${url || "http://localhost:1290"}), so the agent won't text the link`) : ok(`public at ${url}`);
console.log();
