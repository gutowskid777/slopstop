# The Idea Map

Text an idea to an iMessage agent. It tells you if the idea is worth building, files it on a public map, and
introduces you to whoever is building next to you.

## The thesis

AI slop isn't slop because it fails. It's slop because the pain of adopting the solution (finding it, onboarding,
learning it, building the habit, paying, upkeep) is bigger than the pain of the problem. Every idea gets a
**pain ratio**: problem pain : solution pain. Bright on the map means the problem hurts more than the fix.
This product tries to pass its own test: no app, no signup, no onboarding. You already know how to text.

## How it works

- Text any idea. You get a title, a branch, the pain ratio, a one-line verdict and one next step to test it.
- Say yes to put it on the public map (private by default).
- When your public idea lands on someone else's branch, you both get asked about an intro. Both yes = connected.
- Commands: `mine`, `map`, `public 2`, `private 2`, `about me: ...`, `help`.

Built at BigRed//Hacks 2026 with [Photon Spectrum](https://photon.codes) (iMessage) and Gemini.

## Run it

```bash
npm i
cp .env.example .env            # add Photon + Gemini keys
npm run agent                   # the iMessage agent
npm run map                     # the map, http://localhost:1290
npm run try -- "my idea"        # brain + storage from the terminal, no iMessage
npm run seed                    # fake public ideas for the map
```

No `GEMINI_API_KEY` = an offline stub brain, so everything runs without keys.
Storage is a JSON file behind the `Store` interface in `src/store.ts` (swap for a hosted DB to deploy).
