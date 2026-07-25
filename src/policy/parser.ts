import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { z } from "zod";

/**
 * Turns the owner's plain-language instructions into a machine-checkable policy.
 *
 * This is the point of the whole design: the user says once, in their own
 * words, what they are willing to sell and for how much — and from then on the
 * agent applies it to every offer without waking them up. The LLM only ever
 * produces this small structured object; it never decides an individual deal.
 */

export const MODEL = "llama-3.3-70b-versatile";

/** Activity categories present in the owner's data (Phase 6.2). */
export const KNOWN_CATEGORIES = [
  "running",
  "cycling",
  "swimming",
  "strength",
] as const;

/** Metrics a buyer can ask to have aggregated. */
export const KNOWN_DATA_TYPES = [
  "performanceScore",
  "sessionCount",
  "activeMinutes",
  "distance",
  "heartRate",
  "vo2max",
  "sleep",
] as const;

export const policySchema = z.object({
  allowedCategories: z
    .array(z.string())
    .describe(
      `Activity categories the user is willing to sell. Use only: ${KNOWN_CATEGORIES.join(", ")}. Empty array means nothing is allowed.`,
    ),
  minPrice: z
    .number()
    .nonnegative()
    .describe("Minimum acceptable price in HBAR for one cohort insight."),
  allowedDataTypes: z
    .array(z.string())
    .describe(
      `Metrics the user is willing to have aggregated. Use only: ${KNOWN_DATA_TYPES.join(", ")}.`,
    ),
});

export type DataPolicy = z.infer<typeof policySchema>;

const SYSTEM_PROMPT =
  "You convert a person's instructions about selling their own fitness data into a strict policy object. " +
  `Valid categories: ${KNOWN_CATEGORIES.join(", ")}. Valid data types: ${KNOWN_DATA_TYPES.join(", ")}. ` +
  "Include only what the person actually permits. If they exclude something, leave it out rather than listing it. " +
  "If they give no price, use 0. Never invent categories or data types outside the valid lists.";

function requireApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "Missing environment variable GROQ_API_KEY — get a free key at https://console.groq.com/keys and add it to .env.",
    );
  }
  return key;
}

/**
 * Drops anything the model invented outside the known vocabularies.
 *
 * The schema guarantees the *shape*; this guarantees the *contents*. A category
 * the data does not contain would silently widen what the agent sells, so an
 * unrecognised value is discarded rather than trusted.
 */
function keepKnown(values: string[], known: readonly string[]): string[] {
  const lookup = new Map(known.map((k) => [k.toLowerCase(), k]));
  const kept = values
    .map((value) => lookup.get(value.trim().toLowerCase()))
    .filter((value): value is string => value !== undefined);
  return [...new Set(kept)];
}

/**
 * Parses a natural-language policy statement.
 *
 * @param input e.g. "Sell my running and cycling data for at least 0.4 HBAR, but never my heart rate."
 */
export async function parsePolicy(input: string): Promise<DataPolicy> {
  if (!input.trim()) {
    throw new Error("Policy input is empty — describe what you are willing to sell.");
  }

  const model = new ChatGroq({
    model: MODEL,
    apiKey: requireApiKey(),
    // The policy must be the same every time it is parsed, not a sample from a
    // distribution — the user set it once and expects it to stay put.
    temperature: 0,
  });

  const structured = model.withStructuredOutput(policySchema, { name: "policy" });
  const raw = await structured.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ]);

  // Validate again after filtering: the model can satisfy the schema while
  // still naming a category that does not exist in the data.
  return policySchema.parse({
    allowedCategories: keepKnown(raw.allowedCategories, KNOWN_CATEGORIES),
    minPrice: raw.minPrice,
    allowedDataTypes: keepKnown(raw.allowedDataTypes, KNOWN_DATA_TYPES),
  });
}
