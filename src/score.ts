// The score. The model only rates the two inputs; this file does the math, so the number is never a vibe.
// The problem counts twice as much as the fix. A fix that costs double the pain scores 0.

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A 0-10 rating, whatever the model hands back. */
export const rating = (n: unknown) => clamp(Math.round(Number(n) || 0), 0, 10);

export const score = (problem: number, fix: number) => clamp(10 * rating(problem) - 5 * rating(fix), 0, 100);

export type Call = "build" | "sharpen" | "drop";

export const call = (s: number): Call => (s >= 70 ? "build" : s >= 40 ? "sharpen" : "drop");
