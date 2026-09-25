"use client";

import { useCallback, useState } from "react";

export type EngineName = "laya" | "jev";

const MIN_KEY_LENGTH = 12;

/**
 * Which model reads fuzzy pastes. Laya (on-device) is selected on every page load. Jev needs the visitor's own
 * TypeSafe key, which lives only in this component's state: it is never written to storage, so a refresh asks again.
 * Selecting Jev without a key asks for one; until it's entered, nothing reads pastes.
 */
export function useEngine() {
  const [engine, setEngine] = useState<EngineName>("laya");
  const [jevKey, setJevKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const choose = useCallback((next: EngineName) => {
    setKeyError(null);
    setEngine(next);
  }, []);

  const submitKey = useCallback((raw: string) => {
    const key = raw.trim();
    if (key.length < MIN_KEY_LENGTH) return setKeyError("That doesn't look like a TypeSafe key.");
    setJevKey(key);
    setKeyError(null);
  }, []);

  /** Forget the key and ask again, with a reason when TypeSafe rejected it. */
  const forgetKey = useCallback((reason: string | null = null) => {
    setJevKey(null);
    setKeyError(reason);
    setEngine("jev");
  }, []);

  const rejectKey = useCallback(() => forgetKey("TypeSafe rejected that key. Check it and try again."), [forgetKey]);
  const changeKey = useCallback(() => forgetKey(), [forgetKey]);

  return {
    engine,
    jevKey,
    askingKey: engine === "jev" && !jevKey,
    keyError,
    choose,
    submitKey,
    rejectKey,
    changeKey,
  } as const;
}
