// Claude writes the words: the read of every text, the "same problem?" check, and the deck copy. Gemini keeps the
// product photos and the idea embeddings, and stays the fallback for the words. On when ANTHROPIC_API_KEY is set.
// The Anthropic credit is a promo with an end date and no card behind it: once it is spent or gone, calls fail
// with a billing or auth error. Then Claude rests for a while and Gemini answers, so nobody waits on a dead call.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

// Sonnet: Dylan's call (10-05), a reply in ~3s. Opus took ~9s and long waits lose people.
const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
/** How long Claude sits out after a billing or auth failure. */
const REST_MS = Number(process.env.CLAUDE_REST_MS ?? 15 * 60_000);

let client: Anthropic | undefined;
const api = () => (client ??= new Anthropic({ maxRetries: 1 }));
let restUntil = 0;

export const claudeOn = () => Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CLAUDE_OFF !== "1" && Date.now() >= restUntil;

/** Photos Claude can read. Anything else (an iPhone HEIC) goes to Gemini. */
export const CLAUDE_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** One call, one JSON object back that matches the schema. Throws on anything else; the caller falls back. */
export async function claudeJson<S extends z.ZodType>(opts: {
  schema: S;
  prompt: string;
  system?: string;
  image?: { mimeType: string; data: Buffer };
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.image) {
    if (!CLAUDE_IMAGES.has(opts.image.mimeType)) throw new Error(`claude can't read ${opts.image.mimeType}`);
    content.push({ type: "image", source: { type: "base64", media_type: opts.image.mimeType as ImageType, data: opts.image.data.toString("base64") } });
  }
  content.push({ type: "text", text: opts.prompt });
  try {
    const res = await api().beta.messages.parse(
      {
        model: MODEL(),
        max_tokens: opts.maxTokens ?? 4000,
        // Short structured reads: the least thinking that holds quality, so a text still gets answered in seconds.
        output_config: { effort: (process.env.CLAUDE_EFFORT as "low" | "medium" | "high") || "low", format: betaZodOutputFormat(opts.schema) },
        // If a safety classifier declines a harmless idea, Anthropic re-runs it on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content }],
      },
      { timeout: opts.timeoutMs ?? 20_000 },
    );
    if (res.stop_reason === "refusal") throw new Error(`claude refused (${res.stop_details?.category ?? "no category"})`);
    if (res.parsed_output == null) throw new Error(`claude gave no parsable answer (${res.stop_reason})`);
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    // Out of credit, a revoked key, or a spend cap: stop trying for a while instead of failing every text.
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || (err instanceof Anthropic.BadRequestError && /credit|billing|spend|limit/i.test(err.message))) {
      restUntil = Date.now() + REST_MS;
      console.error(`claude: resting ${Math.round(REST_MS / 60_000)} min, Gemini answers meanwhile (${err.message.slice(0, 120)})`);
    }
    throw err;
  }
}
