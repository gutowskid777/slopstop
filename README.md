# Bearing

Text it an idea, or what you're building. It scores it out of 100 instantly, then connects you to the builders
closest to it.

Built at BigRed//Hacks 2026 (theme: navigation) on [Photon Spectrum](https://photon.codes) for iMessage, with Gemini.

## The thesis

Most products are slop not because they fail to work, but because adopting the fix hurts more than the problem
did. Fix pain is finding it, onboarding, learning it, building the habit, paying and upkeep.

So the score has two inputs, each 0 to 10: how much the **problem** hurts, and what the **fix** costs to adopt.

```
score = 10 x problem - 5 x fix        (clamped to 0-100)
```

The problem counts twice as much as the fix, and a fix that costs double the pain scores 0. The model only rates
the two inputs. Code does the math.
70 and up is "build it", 40 and up is "sharpen it", below that is "drop it or flip it".

Bearing tries to pass its own test: there is no app, no signup and nothing to learn. You already know how to text.

## What a text gets you

1. **A decision.** The score, the two inputs, one line on why, and one thing to do in the next 24 hours.
2. **One question, once.** Only when you are new and nobody is near you yet, it asks the single thing that changes
   the most ("you in college?"). The answer re-reads the idea and comes back with the plays it unlocks.
3. **A connection.** If another builder is close to your idea, it offers an intro. They only hear about it after
   you say yes, and numbers are only swapped when both of you say yes. Then each side gets a contact card.

Also: `mine`, `me` (what it knows about you, one box you can replace with `me: ...`), `near`, `delete`,
`private`, `public`, `why`, `map`, `stop`, `forget me`. Start a text with `private:` to keep an idea off the map.
A photo of a whiteboard works as an idea. A thumbs-up on the intro question counts as a yes.

## The map

`/` is the idea tree. One trunk, a few big branches, smaller branches off those, and every idea is a leaf.
You zoom: the whole tree shows only the big branches, tap one and it becomes the trunk of its own tree, tap a
smaller branch to read its ideas. **A fruit is an idea worth building** (70 and up), a green leaf is one to
sharpen, a dry leaf is one to drop. A new text grows its leaf the moment it is scored and the tree zooms to it.
Titles and scores only, never who. A leaf with a dark outline was texted in; the rest are samples.

`/graph` is the score itself: problem against fix, with two pins to drag.

`/lines.html` is the earlier line map, kept for comparison (`npm run seed -- --small` restores its short list).

## Run it

```bash
npm i
cp .env.example .env     # Photon + Gemini keys
npm run doctor           # checks the brain, the line and who can text it
npm run seed             # sample ideas so the tree is full before the first text
npm start                # the iMessage agent + the map on http://localhost:1290
npm run demo             # the same, and keeps the Mac awake while it runs
npm run stop             # ends it (it refuses to run twice: two copies would both answer every text)
```

On Photon's shared line a number has to be registered before the agent can talk to it. The **Text it** box on the
map does that and hands back a link that opens Messages, already addressed, with the first text started.

No phone handy:

```bash
npm run try -- "a text line that chases late invoices"     # you
FROM=alex npm run try -- "invoice reminders for tutors"    # a second builder
FROM=alex npm run try -- "yes alex"
```

With `npm start` running, `try` plays inside the live process: the map moves, and anyone in the conversation with a
real number gets a real iMessage.

## How it is built

| File | Job |
| - | - |
| `src/core.ts` | The conversation. One text in, messages out. No transport in it. |
| `src/brain.ts` | Gemini rates problem and fix and writes the words. JSON schema, a fast model first, fallbacks behind it. |
| `src/score.ts` | The math. Six lines. |
| `src/match.ts` | "Closest" in two steps: embeddings find candidates, then a yes/no read decides if it is really the same problem. |
| `src/agent.ts` | iMessage through Spectrum: settles bursts, read receipts, typing, tapbacks, effects, contact cards. |
| `src/photon.ts` | Photon's management API: register a number, get the link that opens Messages. |
| `src/server.ts` | The map, the graph, live updates, the join step. |
| `src/store.ts` | A JSON file behind a `Store` interface. |

## Working on it as a teammate

- Work on your own branch (`git switch -c rithik/<thing>`), push it, open a pull request. Never push straight to `main`.
- **Never run the live agent with the Photon keys on a second machine.** Two copies would both answer every text.
  Without a `.env` everything runs on the offline stub: `npm run try -- "an idea"` and `npm run seed && npm run map`.
- Your own free Gemini key (aistudio.google.com) in `.env` as `GEMINI_API_KEY` gives real scores locally. Nothing else.
- `npm test` and `npx tsc --noEmit` must pass before a pull request.

## Working on the design

The whole site is three files in `public/` and no build step: save, refresh.

- `map.css`: the colors are the tokens at the top (pale paper, taupe bark, sage leaves, gold fruit). Gold means
  "build it" and nothing else.
- `map.js`: `model` decides what one zoom level shows, `build` draws it as a tree (the same code for all three
  levels and for the phone), `draw` moves between levels. Branch shapes come from `limb`, leaves from `leaf`.
- `index.html`: the side panel (the invitation, the key, the example texts, the card for one idea) and the stage.
- `graph.html`: the "how the score works" page, with its own styles in the same palette.

To look at it without the agent or any keys: `npm run seed && npm run map`, then http://localhost:1290.
Add `?static` to the address to skip the motion (for screenshots), and `#/money/saving` to land on a branch.
Check a phone width before a pull request.
