// Fake public ideas so the map renders with no keys. Writes data/db.json (gitignored).
import { JsonStore, newId, type Idea } from "./store.js";

const rows: [string, string, number, number][] = [
  ["campus wayfinding", "Indoor routes for PSB", 7, 3],
  ["campus wayfinding", "Accessible entrance finder", 9, 2],
  ["campus wayfinding", "Late night safe walk", 8, 4],
  ["finding people", "Who here builds agents", 7, 2],
  ["finding people", "Club fair matchmaker", 6, 5],
  ["finding people", "Alumni near me", 5, 6],
  ["study flow", "Office hours radar", 8, 3],
  ["study flow", "Group project sorter", 6, 7],
  ["money", "Split rent by text", 7, 2],
  ["money", "Dining dollar tracker", 4, 6],
  ["events", "Free food alerts", 6, 1],
  ["events", "Hackathon teammate text", 8, 2],
];
const store = new JsonStore();
rows.forEach(([branch, title, p, s], n) => {
  const idea: Idea = {
    id: newId(),
    owner: `seed${n % 5}`,
    text: title,
    title,
    branch,
    problemPain: p,
    solutionPain: s,
    verdict: "seed",
    nextAction: "seed",
    public: true,
    created: new Date().toISOString(),
  };
  store.addIdea(idea);
});
console.log(`seeded ${rows.length} public ideas`);
