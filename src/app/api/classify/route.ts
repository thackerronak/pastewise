import { AuthenticationError } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { FuzzyDetection } from "@/lib/detect/types";
import { classify } from "@/lib/jev/classify";
import { isJevKey, jevClient, KEY_HEADER } from "@/lib/jev/client";

const body = z.object({ text: z.string().trim().min(1).max(20000) });

const elapsed = (started: number) => Math.round(performance.now() - started);

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { text: string }" }, { status: 400 });

  // The visitor's own key, sent with every request and never stored or logged.
  const key = request.headers.get(KEY_HEADER);
  if (!isJevKey(key)) return Response.json({ error: "invalid_key" }, { status: 401 });

  const text = parsed.data.text.slice(0, 4000);
  const started = performance.now();
  try {
    const result = await classify(jevClient(key.trim()), text, request.signal);
    return Response.json({ ...result, source: "jev", latencyMs: elapsed(started) } satisfies FuzzyDetection);
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof AuthenticationError) return Response.json({ error: "invalid_key" }, { status: 401 });
    console.warn("[jev] request failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "jev_unavailable" }, { status: 502 });
  }
}
