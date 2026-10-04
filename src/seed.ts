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
  ["campus life", "dining", "Dining line by text", 6, 1],
  ["campus life", "dining", "Meal swipe sharing", 6, 5],
  ["campus life", "dining", "Late night food map", 3, 4],
  ["campus life", "study spots", "Open library seats", 7, 2],
  ["campus life", "study spots", "Study group matcher", 4, 6],
  ["campus life", "housing", "Sublet swap", 8, 4],
  ["campus life", "housing", "Laundry machine alerts", 6, 2],
  ["campus life", "clubs", "Club dues collector", 7, 3],
  ["campus life", "clubs", "Event RSVP by text", 5, 1],
  ["money", "getting paid", "Invoice chaser", 9, 2],
  ["money", "getting paid", "Gig tax helper", 8, 5],
  ["money", "getting paid", "Tutor pay reminders", 6, 2],
  ["money", "splitting costs", "Split rent by text", 8, 3],
  ["money", "splitting costs", "Trip cost splitter", 4, 3],
  ["money", "saving", "Subscription canceler", 7, 4],
  ["money", "saving", "Textbook price watch", 6, 3],
  ["health", "habits", "Gym buddy check-ins", 6, 2],
  ["health", "habits", "Sleep debt nudges", 5, 4],
  ["health", "habits", "Water intake dashboard", 2, 6],
  ["health", "care", "Refill before you run out", 9, 3],
  ["health", "care", "Appointment wait alerts", 7, 3],
  ["health", "mental health", "Peer check-in line", 8, 2],
  ["health", "mental health", "Therapist finder", 8, 6],
  // The example texts on the map are about this one, so the numbers match: 10 x 10 - 5 x 2 = 90.
  ["getting around", "wayfinding", "Accessible entrances", 10, 2],
  ["getting around", "wayfinding", "Indoor directions", 6, 3],
  ["getting around", "wayfinding", "Parking spot predictor", 5, 6],
  ["getting around", "safety", "Safe walk home", 9, 2],
  ["getting around", "safety", "Late bus tracker", 7, 2],
  ["getting around", "rides", "Airport ride share", 7, 3],
  ["school", "classes", "Syllabus to calendar", 7, 1],
  ["school", "classes", "Office hours queue", 6, 2],
  ["school", "classes", "Course review digest", 4, 4],
  ["school", "studying", "Quiz me from my notes", 7, 2],
  ["school", "studying", "Lecture recap texts", 5, 2],
  ["school", "studying", "Flashcard maker", 3, 5],
  ["work", "job hunt", "Referral finder", 8, 4],
  ["work", "job hunt", "Interview prep partner", 6, 4],
  ["work", "teams", "Standup by text", 5, 2],
  ["work", "teams", "Meeting notes bot", 4, 5],
  ["home", "chores", "Chore rotation texts", 5, 2],
  ["home", "chores", "Fridge expiry alerts", 4, 5],
  ["home", "moving", "Move-out checklist", 6, 2],
  ["community", "volunteering", "Food pantry stock alerts", 8, 2],
  ["community", "volunteering", "Volunteer shift filler", 7, 3],
  ["community", "local", "Lost and found line", 5, 2],
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
