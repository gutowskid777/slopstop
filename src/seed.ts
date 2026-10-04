// Sample ideas so the tree is full before the first real text lands. They are marked as samples,
// never counted as builders and never matched or messaged. Static data: no model is called.
// npm run seed             refresh the samples, keep everything real
// npm run seed -- --small  the short list (45), for the older line map at /lines.html
// npm run seed -- --none   remove the samples
// npm run seed -- --reset  wipe everything (people, ideas, intros), then add the samples
// npm run seed -- --forget alex   wipe one person (a test builder), touch nothing else
import { score } from "./score.js";
import { JsonStore, newId, type Idea } from "./store.js";

// "big branch/smaller branch": "Title problem fix; Title problem fix; ..."  Both ratings are 0-10 and the
// code does the math, exactly as it does for a real text.
const TREE: Record<string, string> = {
  "campus life/dining":
    "Dining line by text 6 1; Meal swipe sharing 6 5; Late night food map 3 4; Dining hall menu texts 5 1; Allergy-safe menu alerts 8 2; Leftover food alerts 8 2; Group order splitter 4 3",
  "campus life/housing":
    "Sublet swap 8 4; Laundry machine alerts 6 2; Roommate matcher 6 5; Lease review helper 7 3; Housing lottery guide 5 3; Dorm repair tracker 6 2; Move-in day planner 4 2",
  "campus life/clubs": "Club dues collector 7 3; Event RSVP by text 5 1; Club handoff notes 7 2; Member attendance log 4 2; Club budget tracker 5 4; Recruiting calendar 5 2",
  "campus life/study spots": "Open library seats 7 2; Study group matcher 4 6; Quiet room booking 5 3; Outlet finder 3 2; Late night study map 4 2; Whiteboard room alerts 3 3",
  "campus life/events": "Free food finder 6 1; Campus event digest 5 1; Ticket resale board 6 3; Speaker Q&A queue 3 3; Party safety check-ins 8 2; Intramural team finder 4 3",

  "school/classes": "Syllabus to calendar 7 1; Office hours queue 6 2; Course review digest 4 4; Class swap finder 7 3; Prereq path planner 6 3; Waitlist watcher 8 1; Professor reply nudges 4 2",
  "school/studying": "Quiz me from my notes 7 2; Lecture recap texts 5 2; Flashcard maker 3 5; Exam cram planner 6 3; Practice problem bank 5 4; Study streak buddy 4 2",
  "school/group projects": "Who does what tracker 8 2; Slacker nudges 6 2; Meeting time finder 6 1; Shared draft merger 5 4; Peer review swap 4 3; Deadline countdown texts 5 1",
  "school/research": "Lab opening alerts 7 2; Paper summary texts 5 2; Citation fixer 5 3; Survey recruit board 7 3; Lab notebook by voice 4 4; Grant deadline watch 6 2",
  "school/advising": "Degree audit checker 9 3; Advisor slot alerts 6 1; Major picker quiz 4 3; Transfer credit lookup 7 4; Graduation checklist 6 2",
  "school/writing": "Essay feedback loop 6 3; Thesis progress nudges 6 2; Plagiarism self-check 4 3; Reading load planner 5 2; Writing center booking 3 2",

  "money/getting paid": "Invoice chaser 9 2; Gig tax helper 8 5; Tutor pay reminders 6 2; Late paycheck tracker 8 3; Tip pooling split 6 3; Freelance rate guide 5 3",
  "money/splitting costs": "Split rent by text 8 3; Trip cost splitter 4 3; Roommate grocery ledger 3 5; Utility bill splitter 6 2; Group gift collector 5 2; Shared streaming split 3 3",
  "money/saving": "Subscription canceler 7 4; Textbook price watch 6 3; Round-up savings texts 4 4; Student discount finder 5 1; Free trial reminder 6 1; Price drop alerts 4 2",
  "money/budgeting": "Weekly spend text 6 1; Overdraft warning 8 2; Budget by envelope 5 5; Food budget coach 5 3; Loan payoff planner 7 4; Paycheck planner 6 3",
  "money/student aid": "Scholarship matcher 8 3; FAFSA deadline nudges 8 1; Aid appeal helper 8 4; Loan terms explainer 7 3; Work study finder 6 2; Emergency grant finder 9 3",
  "money/investing": "First index fund guide 5 4; Roth for students 5 4; Stock club tracker 3 4; Crypto tax sorter 5 6; Dividend reminder 2 3",

  "health/habits": "Gym buddy check-ins 6 2; Sleep debt nudges 5 4; Water intake dashboard 2 6; Screen time truce 6 4; Morning routine texts 4 2; Stretch break pings 3 1",
  "health/care":
    "Refill before you run out 9 3; Appointment wait alerts 7 3; Symptom journal 5 5; Insurance claim helper 9 5; Find an in-network doc 8 4; Vaccine record keeper 5 3; Urgent care wait times 8 2",
  "health/mental health": "Peer check-in line 8 2; Therapist finder 8 6; Mood log by text 5 2; Crisis plan card 9 3; Burnout early warning 7 4; Loneliness buddy match 7 5",
  "health/food": "Meal prep planner 5 4; Allergy scanner 8 4; Cheap protein finder 4 2; Dorm microwave recipes 4 1; Grocery list by text 4 2; Eating on $40 a week 6 2",
  "health/fitness": "Pickup game finder 5 3; Running route safety 6 3; Lifting form check 5 5; Workout split texts 3 2; Rec center crowd meter 5 2; Injury rehab reminders 7 3",

  // The example texts on the site are about "Accessible entrances", so the numbers match: 10 x 10 - 5 x 2 = 90.
  "getting around/wayfinding":
    "Accessible entrances 10 2; Indoor directions 6 3; Parking spot predictor 5 6; Elevator outage alerts 9 2; Fastest walk to class 5 2; Construction detour map 4 2; Find my lecture hall 6 1",
  "getting around/safety": "Safe walk home 9 2; Late bus tracker 7 2; Blue light map 6 2; Walk with a friend 7 3; Icy path reports 6 2; Lost phone relay 5 4",
  "getting around/rides": "Airport ride share 7 3; Break ride board 7 2; Carpool to internship 6 4; Grocery run share 5 2; Designated driver line 8 3",
  "getting around/transit": "Bus arrival texts 7 1; Route change alerts 6 1; Transit pass reminder 4 1; Missed bus backup 6 3; Bike share dock status 5 2; Night shuttle request 7 2",
  "getting around/bikes": "Bike rack finder 3 3; Bike theft registry 7 4; Flat tire help line 5 3; Scooter charge map 3 3; Used bike marketplace 5 4",
  "getting around/travel": "Cheap flight home watch 6 2; Visa paperwork tracker 9 4; Study abroad packing 3 2; Layover planner 3 4; Passport renewal nudges 6 1",

  "work/job hunt":
    "Referral finder 8 4; Interview prep partner 6 4; Application tracker 5 5; Resume line fixer 6 2; Job post alerts by fit 7 3; Ghosted follow-up nudges 6 1; Salary data by text 7 3",
  "work/internships": "Intern deadline radar 8 2; Housing for interns 8 4; Offer comparison 6 3; Return offer tracker 4 3; First week checklist 4 1; Intern cohort intro 5 3",
  "work/teams": "Standup by text 5 2; Meeting notes bot 4 5; On-call swap board 7 3; Decision log 5 4; New hire buddy 5 3; Shift swap line 8 2",
  "work/freelancing": "Client intake by text 6 3; Scope creep alarm 7 4; Contract plain english 7 3; Portfolio from projects 5 5; Quote calculator 5 3; Late payer follow-ups 8 2",
  "work/networking": "Coffee chat scheduler 5 2; Follow-up reminders 7 1; Alumni finder 6 3; Who to thank list 4 1; Warm intro requests 7 3; Business card to contact 3 3",
  "work/side hustles": "Resell flip tracker 4 4; Tutoring marketplace 6 5; Craft sale checkout 5 3; Campus delivery runs 5 5; Print shop orders 4 4",

  "home/chores": "Chore rotation texts 5 2; Fridge expiry alerts 4 5; Trash day reminder 4 1; Shared supplies list 5 2; Dish duty roulette 3 1; Cleaning checklist 3 2",
  "home/moving": "Move-out checklist 6 2; Furniture hand-me-downs 6 4; Storage space share 7 4; Deposit return guide 9 3; Address change helper 6 3; Moving truck split 5 3",
  "home/roommates": "House rules by vote 5 3; Guest heads-up texts 4 1; Noise truce line 5 2; Roommate agreement 6 3; Thermostat peace treaty 3 3; Quiet hours reminder 4 1",
  "home/cooking": "What can I cook tonight 5 3; Shared dinner signup 4 2; Recipe from fridge photo 5 3; Batch cook planner 4 4; Spice rack swap 2 3",
  "home/repairs": "Landlord repair log 9 3; Fix-it video finder 5 2; Tool lending shelf 4 4; Leak photo report 7 2; Appliance manual finder 4 2",
  "home/pets": "Plant watering texts 3 1; Pet sitter swap 6 4; Vet reminder line 5 2; Lost pet alert 8 3; Dog walk share 4 4",

  "community/volunteering":
    "Food pantry stock alerts 8 2; Volunteer shift filler 7 3; Tutoring kids signup 6 3; Blood drive reminders 6 1; Service hours log 5 2; Skill-based volunteering 5 4",
  "community/local": "Lost and found line 5 2; Neighborhood tool share 4 6; Town meeting digest 5 2; Pothole report text 5 2; Local business deals 3 3; Community fridge map 7 2",
  "community/giving": "Donation match finder 5 3; Clothing drive pickups 5 3; Mutual aid requests 9 3; Fundraiser receipts 4 3; Textbook donation loop 5 2",
  "community/civic": "Voter registration nudge 7 1; Ballot explainer 6 2; Rep contact helper 4 2; Jury duty guide 4 3; Polling place finder 6 1",
  "community/friends": "Plan picker for groups 6 2; Birthday reminders 4 1; Who's free tonight 5 2; Trip planning vote 5 3; Photo dump collector 3 2; Long distance check-ins 5 2",
  "community/newcomers": "New in town guide 6 3; Intl student help line 9 3; Language exchange match 6 4; First winter survival 5 2; Bank account setup guide 7 3",

  "productivity/focus": "Phone lockbox timer 6 3; Shorts blocker 7 3; Deep work buddy 5 3; Tab hoarder cleanup 4 2; One thing today text 5 1; Distraction log 3 3",
  "productivity/planning": "Weekly plan by text 6 2; Deadline radar 8 2; Calendar from a photo 6 2; Time estimate coach 5 4; Sunday reset checklist 4 1; Overcommit warning 6 3",
  "productivity/notes": "Voice note to tasks 6 2; Meeting notes cleanup 5 3; Find that note search 6 4; Whiteboard photo to text 5 2; Highlights digest 3 3",
  "productivity/email": "Inbox triage texts 7 4; Reply later nudges 6 1; Unsubscribe sweep 5 2; Group chat catch-up 6 2; Follow-up tracker 6 2; Email to calendar 5 2",
  "productivity/habits": "Habit streak texts 4 2; Bedtime wind-down 5 3; Morning brief 4 2; Accountability partner 6 3; Quit vaping coach 9 4",
};

// The short list the line map was built around: 45 ideas, 8 trunks, 21 branches.
const SMALL: Record<string, string> = {
  "campus life/dining": "Dining line by text 6 1; Meal swipe sharing 6 5; Late night food map 3 4",
  "campus life/study spots": "Open library seats 7 2; Study group matcher 4 6",
  "campus life/housing": "Sublet swap 8 4; Laundry machine alerts 6 2",
  "campus life/clubs": "Club dues collector 7 3; Event RSVP by text 5 1",
  "money/getting paid": "Invoice chaser 9 2; Gig tax helper 8 5; Tutor pay reminders 6 2",
  "money/splitting costs": "Split rent by text 8 3; Trip cost splitter 4 3",
  "money/saving": "Subscription canceler 7 4; Textbook price watch 6 3",
  "health/habits": "Gym buddy check-ins 6 2; Sleep debt nudges 5 4; Water intake dashboard 2 6",
  "health/care": "Refill before you run out 9 3; Appointment wait alerts 7 3",
  "health/mental health": "Peer check-in line 8 2; Therapist finder 8 6",
  "getting around/wayfinding": "Accessible entrances 10 2; Indoor directions 6 3; Parking spot predictor 5 6",
  "getting around/safety": "Safe walk home 9 2; Late bus tracker 7 2",
  "getting around/rides": "Airport ride share 7 3",
  "school/classes": "Syllabus to calendar 7 1; Office hours queue 6 2; Course review digest 4 4",
  "school/studying": "Quiz me from my notes 7 2; Lecture recap texts 5 2; Flashcard maker 3 5",
  "work/job hunt": "Referral finder 8 4; Interview prep partner 6 4",
  "work/teams": "Standup by text 5 2; Meeting notes bot 4 5",
  "home/chores": "Chore rotation texts 5 2; Fridge expiry alerts 4 5",
  "home/moving": "Move-out checklist 6 2",
  "community/volunteering": "Food pantry stock alerts 8 2; Volunteer shift filler 7 3",
  "community/local": "Lost and found line 5 2",
};

const rows = (tree: Record<string, string>) =>
  Object.entries(tree).flatMap(([where, list]) => {
    const [trunk, branch] = where.split("/");
    return list.split("; ").map((item) => {
      const [, title, problem, fix] = item.match(/^(.+) (\d+) (\d+)$/) ?? [];
      if (!title) throw new Error(`bad sample: "${item}" in ${where}`);
      return { trunk, branch, title, problem: Number(problem), fix: Number(fix) };
    });
  });

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
  const list = rows(process.argv.includes("--small") ? SMALL : TREE);
  list.forEach(({ trunk, branch, title, problem, fix }, n) => {
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
      created: new Date(Date.now() - (list.length - n) * 6 * 60_000).toISOString(),
    };
    store.addIdea(idea);
  });
  const trunks = new Set(list.map((r) => r.trunk)).size, branches = new Set(list.map((r) => `${r.trunk}/${r.branch}`)).size;
  console.log(`${reset ? "wiped everything, then " : ""}added ${list.length} sample ideas across ${trunks} big branches and ${branches} smaller ones`);
}
