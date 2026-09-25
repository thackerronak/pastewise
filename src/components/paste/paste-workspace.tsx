"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ToolBoundary } from "@/components/tools/tool-boundary";
import { ToolFor } from "@/components/tools/registry";
import { useDetection, type Engine } from "@/hooks/use-detection";
import { useEngine } from "@/hooks/use-engine";
import { useLaya } from "@/lib/laya/client";
import { EASE_OUT, panel, row } from "@/lib/motion";
import { EngineControl } from "./engine-control";
import { KindBadge } from "./kind-badge";
import { LatencyHud } from "./latency-hud";
import { SAMPLES } from "./samples";

const PLACEHOLDERS = ["Paste some JSON", "Paste a JWT", "Paste a cron expression", "Paste a stack trace", "Paste a color"];

export function PasteWorkspace() {
  const [text, setText] = useState("");
  const [placeholder, setPlaceholder] = useState(0);
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
  const { detection, pending, error } = useDetection(text, active);
  // No model, no box: until the selected engine can read pastes (Laya loaded, or Jev with a key), a layer over the
  // paste box asks for what it needs.
  const locked = active.name === "laya" && !active.ready;

  useEffect(() => {
    const id = setInterval(() => setPlaceholder((i) => (i + 1) % PLACEHOLDERS.length), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid w-full max-w-2xl gap-4">
        <div className={locked ? "relative min-h-80" : "relative"}>
        <div inert={locked} aria-hidden={locked} className="grid gap-4">
        <div className="focus-glow overflow-hidden rounded-[28px] border bg-card">
          <Textarea
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setText("")}
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
                <motion.p variants={row} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Kbd>Esc</Kbd> to clear
                </motion.p>
              </div>
            </motion.div>
          )}
        </div>
        {!text && (
          <div className="grid gap-2 text-center text-sm text-muted-foreground">
            <p>Paste anything. It becomes the tool you need.</p>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
              <span>Try</span>
              {SAMPLES.map(([label, sample]) => (
                <button
                  key={label}
                  onClick={() => setText(sample)}
                  className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
        <AnimatePresence initial={false}>
          {locked && (
            <motion.div
              key="locked"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="absolute inset-0 grid place-content-center gap-4 rounded-[28px] bg-background/70 p-4 text-center backdrop-blur-sm"
            >
              <div className="grid gap-1">
                <p className="font-medium">{engine.askingKey ? "Enter your TypeSafe key" : "Choose a model to start"}</p>
                <p className="text-sm text-muted-foreground">
                  {engine.askingKey
                    ? "Jev reads your pastes in the cloud with your own key. Or switch to Laya to run on-device."
                    : "Download Laya to run it in your browser, or use Jev with your TypeSafe key."}
                </p>
              </div>
              <EngineControl engine={engine} model={model} />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
        {!locked && <EngineControl engine={engine} model={model} />}
        <LatencyHud detection={detection} pending={pending} error={error} />
      </div>
    </MotionConfig>
  );
}
