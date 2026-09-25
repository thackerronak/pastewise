import "server-only";
import { TypeSafeClient } from "@typesafe-ai/sdk";

const MODEL = process.env.JEV_MODEL || "jev-latest";

export const KEY_HEADER = "x-typesafe-key";

export const isJevKey = (key: string | null): key is string => (key?.trim().length ?? 0) >= 12;

// Jev is called from the server only because api.typesafe.ai doesn't allow browser (CORS) requests. The key is the
// visitor's own, sent with each request and never stored, so each request gets its own client.
export const jevClient = (apiKey: string) =>
  new TypeSafeClient({ apiKey, defaultModel: MODEL, retry: { maxRetries: 0 }, timeout: 3000 });
