import "server-only";
import { serverEnv } from "@/lib/server-env";
import type { VisaRequirement } from "./rules";

const MAX_TEXT_CHARS = 6000;

const SYSTEM_PROMPT = `You classify job postings by whether they restrict applicants to Australian citizens and/or permanent residents.
Answer with JSON only: {"requirement": "restricted" | "open" | "unknown"}.
- "restricted": the posting requires citizenship or permanent residency (or a security clearance that implies it, e.g. NV1/NV2/Baseline) as a hard condition.
- "open": the posting explicitly accepts non-citizens, or only says citizenship is NOT required, or offers visa sponsorship.
- "unknown": the posting does not say, or only mentions citizenship as a preference or nice-to-have, or the intent is unclear.
Be careful: a phrase like "no citizenship required" mentions citizenship but is NOT a restriction. "Right to work in Australia" alone is not a restriction.`;

export const isAiConfigured = () => Boolean(serverEnv.AI_API_KEY);

export const classifyVisaWithAi = async (
  title: string,
  description: string,
): Promise<VisaRequirement> => {
  if (!serverEnv.AI_API_KEY) {
    throw new Error("AI is not configured. Set AI_API_KEY in apps/web/.env.local");
  }

  const text = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, MAX_TEXT_CHARS);

  const response = await fetch(`${serverEnv.AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverEnv.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: serverEnv.AI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Title: ${title}\n\nPosting:\n${text}` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";

  try {
    const value = (JSON.parse(content) as { requirement?: string }).requirement;
    if (value === "restricted" || value === "open" || value === "unknown") {
      return value;
    }
  } catch {
    // fall through
  }

  return "unknown";
};
