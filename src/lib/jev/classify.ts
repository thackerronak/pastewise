import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { questions } from "./questions";

/**
 * The one classification call, shared by every engine: the same questions through the TypeSafe SDK. Jev passes a
 * client for api.typesafe.ai (built on the server with the visitor's key), Laya one whose fetch is answered on-device.
 */
export async function classify(client: TypeSafeClient, text: string, signal?: AbortSignal) {
  const res = await client.systemOne({ state: { pasted: text }, questions }, { signal });
  const { kind, language, cause } = res.answers;
  return { kind: kind.choice, language: language.choice, cause: cause.choice, model: res.model };
}
