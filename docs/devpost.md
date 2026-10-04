# Bearing · Devpost submission (paste field by field)
# Deadline 8:30 AM Sun, target 8:00. Needs: public GitHub link + Drive link to deck.pdf ("anyone with link").

## Project name
Bearing

## Tagline
Text it an idea. It scores it out of 100 instantly, then connects you to the builders closest to it.

## Tracks to tick
- BigRed Track (automatic)
- Photon: Agents in iMessage using Photon
- Software Track
- Design Track
- Beginner Track
- MLH: Best Use of Gemini API

## Inspiration
Most AI products aren't slop because they don't work. They're slop because the fix hurts more than the problem did.
Finding it, signing up, learning the UI, building the habit, paying, keeping it up. If the problem doesn't hurt more than all of that, nobody switches, no matter how good it looks.

I kept seeing it in what people around me build, and I wanted a way to check an idea against that before anyone spends a weekend on it. Then I wanted the next step too: if someone else is on the same problem, you should meet them.

## What it does
You text Bearing an idea, or what you're already building. In about 4 seconds it texts back:
- a score out of 100, with the two numbers under it: how much the problem hurts and how much the fix costs to adopt, each 0 to 10
- one line on why, a call (build it, sharpen it, or drop it), and one thing to do in the next 24 hours

The math is fixed: score = 10 × problem − 5 × fix. The problem counts twice as much as the fix. Loss aversion is the reason: people weigh giving up what they do now at about 2x.

If you're new and nobody is close yet, it asks one question, once, the one that changes the most (like "you in college?"), and comes back with the plays that answer unlocks.

When another builder texts an idea on the same problem, Bearing offers you both an intro. The other person hears nothing until you say yes. Numbers only swap when both say yes, then each side gets a contact card.

Every idea lands live on a map: each space is a trail, each idea a waypoint, and height is the score. Titles and scores only, never who. Start a text with `private:` and it stays off the map.

There's no app and no signup. You already know how to text.

## How we built it
- iMessage through Photon's Spectrum (spectrum-ts) on the managed cloud: read receipts, typing, tapbacks, effects, contact cards.
- Gemini rates the two inputs and writes the words, with a JSON schema so it can't skip the ratings. A fast flash-lite model goes first (about a second), with fallbacks behind it.
- The score is six lines of TypeScript, not the model. Same text, same score.
- Matching is two steps: Gemini embeddings find candidates, then a yes/no read decides if it's really the same problem.
- A small Node server serves the map and the score graph, pushes live updates, and handles joining (Photon's API registers your number and returns a link + QR that opens Messages already addressed).
- Storage is a JSON file behind a Store interface, so it can move to a real database without touching the rest.

## Challenges we ran into
- Photon's Pro tier is a shared line. The agent can only talk to registered numbers and can't text first, so joining had to become one step: type your number on the map, scan the QR, Messages opens with "my idea:" started.
- Real texts broke things tests didn't. My second text answered Bearing's question and pitched a new idea in the same message, and it re-scored my first idea with the second one's numbers. Fixed: context can never rewrite what an idea is.
- Matching was too loose. A laundry tracker got matched to a notes app. Now embeddings only pick candidates and a second read decides.
- The model would say it deleted something it hadn't. Now delete is a real command and the model can't claim actions.
- "ok" isn't consent. Swapping numbers takes a clear yes from both people.
- The free Gemini key allows about 15 scored texts a minute per model. Backup models with their own allowance plus a short wait-and-retry keep it up under load.

## Accomplishments that we're proud of
- It passes its own test. Nothing to download, nothing to learn.
- A real reply on a real phone in about 4 seconds.
- We ran 55 weird texts through the live brain (long voice dumps, one word, two ideas in one text, rude, off topic) and fixed what broke.
- The score is explainable in one sentence and the same idea always gets the same number.

## What we learned
The hard part of an AI product isn't the model. It's everything around it: what counts as consent, when to ask a question, when to stay quiet, what the model is never allowed to claim. And the product only felt right once the fix had less pain than the problem, which is the whole thesis.

## What's next
- A dedicated line, so anyone can text one number without joining first.
- Clubs, classes and hackathons as the first maps: rooms full of builders are where intros matter most.
- Smarter intros: same problem, different approach, the pairs most worth meeting.

## Built with
typescript, node.js, photon, spectrum-ts, imessage, gemini, gemini-embeddings, qrcode, html, css, svg

## Links
- GitHub: https://github.com/gutowskid777/bearing (flip to PUBLIC before submitting)
- Deck: <Drive link to deck.pdf, "anyone with the link">

---

## People's Choice ask (text to friends after 8:30 AM)
built a thing at BigRed this weekend: text it an idea, it scores it out of 100 and connects you to people building the same thing.
would mean a lot if you upvoted it on devpost: <project link>
