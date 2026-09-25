"use client";

import { MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ToolBoundary } from "@/components/tools/tool-boundary";
import { ToolFor } from "@/components/tools/registry";
import { useDetection, type Engine } from "@/hooks/use-detection";
import { useEngine } from "@/hooks/use-engine";
import { detectByRules } from "@/lib/detect/rules";
import { useLaya } from "@/lib/laya/client";
import { panel, row } from "@/lib/motion";
import { EnginePanel, EngineTabs, NeedsModel } from "./engine-control";
import { KindBadge } from "./kind-badge";
import { LatencyHud } from "./latency-hud";
import { SAMPLES } from "./samples";

const PLACEHOLDERS = ["Paste some JSON", "Paste a JWT", "Paste a cron expression", "Paste a stack trace", "Paste a color"];

// Samples the exact-format rules can't read (stack traces, code) need a model; they're marked while there isn't one.
const SAMPLE_NEEDS_MODEL = new Set(SAMPLES.filter(([, sample]) => detectByRules(sample) === null).map(([label]) => label));

const EscHint = () => (
  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
    <Kbd>Esc</Kbd> to clear
  </p>
);

export function PasteWorkspace() {
  const [text, setText] = useState("");
  const [placeholder, setPlaceholder] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const engine = useEngine();
  const model = useLaya();
  const { jevKey, rejectKey } = engine;
  const setup = model.active ? `${model.active.build === "q8e8" ? "int8" : "int4"} · ${model.active.device}` : "";
  // Jev without a key reads nothing, the same as Laya before its model is loaded.
  const active = useMemo<Engine>(
    () =>
      engine.engine === "jev" && jevKey
        ? { name: "jev", key: jevKey, onInvalidKey: rejectKey }
        : { name: "laya", ready: engine.engine === "laya" && model.status === "ready", setup },
    [engine.engine, jevKey, rejectKey, model.status, setup],
  );
  const { detection, pending, error, needsModel } = useDetection(text, active);
  const hasModel = active.name === "jev" || active.ready;

  const focusBox = useCallback(() => setTimeout(() => box.current?.focus({ preventScroll: true }), 0), []);

  // After a tab switch, and when Laya finishes loading or a Jev key is accepted, the cursor goes back to the paste box
  // so the next paste needs no click. Jev without a key is the exception: its key field takes focus instead.
  // Deferred a tick: the tab's own mousedown focus would otherwise win.
  useEffect(() => {
    if (engine.askingKey) return;
    const id = focusBox();
    return () => clearTimeout(id);
  }, [engine.engine, engine.askingKey, hasModel, focusBox]);

  // Esc clears from anywhere on the page (after clicking a sample, say), not only while the box has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement) return; // the Jev key field
      setText("");
      focusBox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusBox]);

  useEffect(() => {
    const id = setInterval(() => setPlaceholder((i) => (i + 1) % PLACEHOLDERS.length), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid w-full max-w-2xl gap-4">
        <EngineTabs engine={engine} />
        <div className="focus-glow overflow-hidden rounded-[28px] border bg-card">
          <Textarea
            ref={box}
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`${PLACEHOLDERS[placeholder]}…`}
            aria-label="Pasted content"
            spellCheck={false}
            className="max-h-48 min-h-0 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-xl shadow-none focus-visible:ring-0 md:text-xl [&:not(:placeholder-shown)]:font-mono [&:not(:placeholder-shown)]:text-sm"
          />
          {detection && (
            <motion.div variants={panel} initial="hidden" animate="shown">
              <div className="grid gap-5 px-5 pt-1 pb-4">
                <motion.div variants={row}>
                  <KindBadge detection={detection} />
                </motion.div>
                <motion.div key={detection.kind} variants={row} initial="hidden" animate="shown">
                  <ToolBoundary key={text}>
                    <ToolFor text={text} detection={detection} />
                  </ToolBoundary>
                </motion.div>
                <motion.div variants={row}>
                  <EscHint />
                </motion.div>
              </div>
            </motion.div>
          )}
          {needsModel && (
            <motion.div variants={panel} initial="hidden" animate="shown">
              <div className="grid gap-4 px-5 pt-1 pb-4">
                <motion.div variants={row}>
                  <NeedsModel engine={engine} model={model} />
                </motion.div>
                <motion.div variants={row}>
                  <EscHint />
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>
        <div className="grid gap-2 text-center text-sm text-muted-foreground">
          {!text && <p>Paste anything. It becomes the tool you need.</p>}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            <span>Try</span>
            {SAMPLES.map(([label, sample]) => {
              const marked = !hasModel && SAMPLE_NEEDS_MODEL.has(label);
              return (
                <button
                  key={label}
                  onClick={() => {
                    setText(sample);
                    focusBox();
                  }}
                  title={marked ? "Needs a model: download Laya or add a Jev key" : undefined}
                  className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                >
                  {label}
                  {marked && <span aria-label="needs a model" className="size-1.5 rounded-full bg-amber-500" />}
                </button>
              );
            })}
          </div>
          {!hasModel && (
            <p className="flex items-center justify-center gap-1.5 text-xs">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
              Stack traces, code and prose need a model. Exact formats like JSON or JWTs work right away.
            </p>
          )}
        </div>
        <EnginePanel engine={engine} model={model} />
        <LatencyHud detection={detection} pending={pending} error={error} />
      </div>
    </MotionConfig>
  );
}
