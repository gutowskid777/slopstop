// Sample ideas so the map has terrain before the first real text lands. They are marked as samples,
// drawn hollow on the map, never counted as builders and never matched or messaged.
// npm run seed             refresh the samples, keep everything real
// npm run seed -- --none   remove the samples
// npm run seed -- --reset  wipe everything (people, ideas, intros), then add the samples
// npm run seed -- --forget alex   wipe one person (a test builder), touch nothing else
import { score } from "./score.js";
import { JsonStore, newId, type Idea } from "./store.js";

// trunk, branch, title, problem, fix
const rows: [string, string, string, number, number][] = [
  ["campus life", "dining", "Shortest dining line by text", 5, 1],
  ["campus life", "dining", "Meal swipe sharing", 6, 5],
  ["campus life", "dining", "Late night food map", 3, 4],
  ["campus life", "study spots", "Open library seats bot", 7, 2],
  ["campus life", "study spots", "Quiet room booking", 5, 3],
  ["campus life", "study spots", "Group study matcher app", 4, 6],
  ["money", "getting paid", "Invoice chaser for freelancers", 9, 2],
  ["money", "getting paid", "Club dues collector", 7, 3],
  ["money", "getting paid", "Tutor payment reminders", 5, 2],
  ["money", "splitting costs", "Split rent by text", 8, 3],
  ["money", "splitting costs", "Trip cost splitter", 4, 3],
  ["money", "splitting costs", "Roommate grocery ledger", 3, 5],
  ["health", "habits", "Refill before you run out", 9, 3],
  ["health", "habits", "Gym buddy check-in texts", 6, 2],
  ["health", "habits", "Sleep debt nudges", 5, 4],
  ["health", "habits", "Water intake dashboard", 2, 6],
  ["getting around", "wayfinding", "Accessible entrance finder", 10, 2],
  ["getting around", "wayfinding", "Safe walk home at night", 8, 2],
  ["getting around", "wayfinding", "Indoor directions for big buildings", 6, 3],
  ["getting around", "wayfinding", "Parking spot predictor app", 5, 6],
];

const store = new JsonStore();
const who = process.argv.indexOf("--forget");
if (who > -1) {
  for (const id of process.argv.slice(who + 1)) store.forget(id);
  console.log(`forgot ${process.argv.slice(who + 1).join(", ")}`);
  process.exit(0);
}
const reset = process.argv.includes("--reset");
store.drop((i) => reset || Boolean(i.sample), reset);
if (process.argv.includes("--none")) {
  console.log("samples removed");
} else {
  rows.forEach(([trunk, branch, title, problem, fix], n) => {
    const idea: Idea = {
      id: newId(),
      owner: `sample${n}`,
      text: title,
      title,
      gist: title,
      trunk,
      branch,
      problem,
      fix,
      score: score(problem, fix),
      verdict: "",
      move: "",
      private: false,
      sample: true,
      created: new Date(Date.now() - (rows.length - n) * 40 * 60_000).toISOString(),
    };
    store.addIdea(idea);
  });
  console.log(`${reset ? "wiped everything, then " : ""}added ${rows.length} sample ideas`);
}
