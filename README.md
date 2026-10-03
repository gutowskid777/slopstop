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

Also: `mine`, `private`, `public`, `why`, `map`, `stop`, `forget me`. Start a text with `private:` to keep an idea off the map.
A photo of a whiteboard works as an idea. A thumbs-up on the intro question counts as a yes.

## The map

`/` is the branch map: every trunk is a trail, every branch a fork, every idea a waypoint, and **height is the
score**. It updates the moment a text is scored. Titles and scores only, never who. Hollow markers are samples.

`/graph` is the score itself as terrain: problem against fix, with two pins to drag.

## Run it

```bash
npm i
cp .env.example .env     # Photon + Gemini keys
npm run doctor           # checks the brain, the line and who can text it
npm run seed             # sample ideas so the map has terrain
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
| `src/match.ts` | "Closest" = cosine distance between idea embeddings. |
| `src/agent.ts` | iMessage through Spectrum: settles bursts, read receipts, typing, tapbacks, effects, contact cards. |
| `src/photon.ts` | Photon's management API: register a number, get the link that opens Messages. |
| `src/server.ts` | The map, the graph, live updates, the join step. |
| `src/store.ts` | A JSON file behind a `Store` interface. |
