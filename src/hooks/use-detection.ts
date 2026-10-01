"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectByRules } from "@/lib/detect/rules";
import type { Detection, FuzzyDetection } from "@/lib/detect/types";
import { classifyOnDevice } from "@/lib/on-device/client";
import type { ModelId } from "@/lib/on-device/protocol";

export type Engine =
  | { name: "device"; ready: boolean; model: ModelId; setup: string }
  | { name: "jev"; key: string; onInvalidKey: () => void };

const KEY_HEADER = "x-typesafe-key";

async function viaJev(text: string, key: string, signal: AbortSignal, onInvalidKey: () => void): Promise<FuzzyDetection> {
  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "content-type": "application/json", [KEY_HEADER]: key },
    body: JSON.stringify({ text }),
    signal,
  });
  if (res.status === 401) onInvalidKey();
  if (!res.ok) throw new Error(res.status === 401 ? "TypeSafe rejected the key" : "Jev is unavailable right now");
  return res.json();
}

async function viaDevice(text: string, model: ModelId, setup: string, signal: AbortSignal): Promise<FuzzyDetection> {
  const started = performance.now();
  const result = await classifyOnDevice(text.slice(0, 4000), signal);
  const name = `${result.model} · ${setup}`;
  return { ...result, model: name, source: model, latencyMs: Math.round(performance.now() - started) } as FuzzyDetection;
}

type Outcome = { text: string; engineId: string } & ({ result: FuzzyDetection } | { error: string });

export function useDetection(text: string, engine: Engine, debounceMs = 300) {
  const ruleKind = useMemo(() => detectByRules(text), [text]);
  const fuzzyText = !ruleKind && text.trim().length > 0;
  // Text the rules can't pin down needs a model: the on-device one once it's loaded, or Jev with a key.
  const available = engine.name === "jev" || engine.ready;
  const useModel = fuzzyText && available;
  // A new model, build, device or key re-reads the paste, so a result always names the setup that produced it.
  const engineId = engine.name === "jev" ? `jev:${engine.key}` : `${engine.model}:${engine.setup}`;
  const latest = useRef(engine);
  useEffect(() => {
    latest.current = engine;
  });

  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!useModel) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const e = latest.current;
      try {
        const result = e.name === "jev" ? await viaJev(text, e.key, controller.signal, e.onInvalidKey) : await viaDevice(text, e.model, e.setup, controller.signal);
        setOutcome({ text, engineId, result });
      } catch (err) {
        if (!controller.signal.aborted) setOutcome({ text, engineId, error: err instanceof Error ? err.message : "The model failed" });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, useModel, engineId, debounceMs]);

  const current = outcome?.text === text && outcome.engineId === engineId ? outcome : null;
  const detection: Detection | null = ruleKind
    ? { kind: ruleKind, source: "rules" }
    : useModel && current && "result" in current
      ? current.result
      : null;
  const error = useModel && current && "error" in current ? current.error : null;

  // Fuzzy text with no model to read it: the page says what's missing instead of guessing.
  const needsModel = fuzzyText && !available;

  return { detection, pending: useModel && !current, error, needsModel };
}
