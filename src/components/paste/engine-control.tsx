"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EngineName, useEngine } from "@/hooks/use-engine";
import { laya, type LayaState } from "@/lib/laya/client";
import { GPU_BUILDS, type Build, type Device } from "@/lib/laya/protocol";
import { swap } from "@/lib/motion";

const BUILD_NAMES: Record<Build, string> = { q4e8: "int4", q8e8: "int8" };

/**
 * Focus an element when it appears, so the next step (typing the key) needs no click.
 * Deferred a tick, like the paste box: a tab switch's own mousedown focus would otherwise win.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const id = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, []);
  return ref;
}

const KEY_INPUT_ID = "jev-key";

/**
 * Shown in place of a result when fuzzy text is pasted with no model to read it: what's missing, and the one action
 * that fixes it for the selected engine.
 */
export function NeedsModel({ engine, model }: Props) {
  const size = model.builds?.find((b) => b.key === model.build)?.bytes;
  const cached = model.cached.includes(model.build);
  const action =
    engine.engine === "jev" ? (
      <Button size="sm" onClick={() => document.getElementById(KEY_INPUT_ID)?.focus()}>Enter your TypeSafe key</Button>
    ) : model.status === "downloading" || model.status === "loading" ? (
      <p className="text-xs">Laya is loading. This paste will be read as soon as it&apos;s ready.</p>
    ) : (
      <Button size="sm" onClick={laya.load}>
        {model.status === "error" ? "Retry Laya" : cached ? "Load Laya · cached" : `Download Laya${size ? ` · ${mb(size)}` : ""}`}
      </Button>
    );
  return (
    <div role="status" className="grid justify-items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">Reading this needs a model</p>
      <p className="text-muted-foreground">
        Stack traces, code and prose are read by a model.{" "}
        {engine.engine === "jev"
          ? "Add your TypeSafe key to use Jev, or switch to Laya to run it in your browser."
          : "Download Laya to run it in your browser, or switch to Jev and add your TypeSafe key."}
      </p>
      {action}
    </div>
  );
}
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

type Props = { engine: ReturnType<typeof useEngine>; model: LayaState };

/** The Laya / Jev switch. It sits above the paste box in every state, so it never moves when the panels change. */
export function EngineTabs({ engine }: Pick<Props, "engine">) {
  return (
    <Tabs value={engine.engine} onValueChange={(v) => engine.choose(v as EngineName)} className="items-center">
      <TabsList aria-label="Model">
        <TabsTrigger value="laya" className="px-3 text-xs">Laya · on-device</TabsTrigger>
        <TabsTrigger value="jev" className="px-3 text-xs">Jev · cloud</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/** What the selected engine needs or reports: Laya's build, device and download, or Jev's key. */
export function EnginePanel({ engine, model }: Props) {
  return (
    <div className="grid justify-items-center gap-2 text-xs text-muted-foreground">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={engine.askingKey ? "key" : engine.engine} {...swap} className="grid justify-items-center gap-2">
          {engine.askingKey ? <KeyForm engine={engine} /> : engine.engine === "laya" ? <LayaPanel model={model} /> : <JevPanel engine={engine} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function KeyForm({ engine }: { engine: Props["engine"] }) {
  const [value, setValue] = useState("");
  const input = useFocusOnMount<HTMLInputElement>();
  return (
    <form
      className="grid justify-items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        engine.submitKey(value);
      }}
    >
      <div className="flex items-center gap-2">
        <input
          id={KEY_INPUT_ID}
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="TypeSafe API key"
          aria-label="TypeSafe API key"
          aria-invalid={!!engine.keyError}
          className="h-7 w-56 rounded-md border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <Button type="submit" size="sm">Use Jev</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => engine.choose("laya")}>Cancel</Button>
      </div>
      <p className={engine.keyError ? "text-destructive" : undefined} aria-live="polite">
        {engine.keyError ?? "Kept only for this tab. You'll be asked again after a refresh."}
      </p>
    </form>
  );
}

function JevPanel({ engine }: { engine: Props["engine"] }) {
  return (
    <p className="flex items-center gap-2">
      Key set for this tab, forgotten on refresh.
      <button
        className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
        onClick={engine.changeKey}
      >
        Change key
      </button>
    </p>
  );
}

function LayaPanel({ model }: { model: LayaState }) {
  const size = (build: Build) => model.builds?.find((b) => b.key === build)?.bytes;
  const gpuAllowed = GPU_BUILDS.includes(model.build) && model.gpuAvailable !== false;
  const busy = model.status === "downloading" || model.status === "loading";

  return (
    <>
      {model.source && (
        <p>
          Model{" "}
          <a
            href={`https://huggingface.co/${model.source}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground underline decoration-dotted underline-offset-4"
          >
            {model.source}
          </a>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Tabs value={model.build} onValueChange={(v) => laya.setBuild(v as Build)}>
          <TabsList aria-label="Model build" className="h-7!">
            {(["q4e8", "q8e8"] as const).map((b) => (
              <TabsTrigger key={b} value={b} disabled={busy || (model.builds !== null && !size(b))} className="px-2 text-xs">
                {BUILD_NAMES[b]}
                {size(b) ? ` · ${mb(size(b)!)}` : ""}
                {b === "q8e8" ? " · CPU only" : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={gpuAllowed ? model.device : "cpu"} onValueChange={(v) => laya.setDevice(v as Device)}>
          <TabsList aria-label="Run on" className="h-7!">
            <TabsTrigger value="gpu" disabled={busy || !gpuAllowed} className="px-2 text-xs">GPU</TabsTrigger>
            <TabsTrigger value="cpu" disabled={busy} className="px-2 text-xs">CPU</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <LayaStatus model={model} size={size(model.build)} />
    </>
  );
}

function LayaStatus({ model, size }: { model: LayaState; size?: number }) {
  const note =
    model.build === "q8e8" ? "int8 runs on CPU only." : model.gpuAvailable === false ? "GPU not available, using CPU." : null;

  switch (model.status) {
    case "idle":
      return (
        <div className="grid justify-items-center gap-1">
          <Button size="sm" variant="outline" onClick={laya.load}>
            {model.cached.includes(model.build) ? "Load model · cached" : `Download model${size ? ` · ${mb(size)}` : ""}`}
          </Button>
          <p>Downloads the model from Hugging Face (a few hundred MB, downloaded once, then cached).</p>
          <p>Runs in your browser; nothing you paste leaves the page.</p>
          {note && <p>{note}</p>}
        </div>
      );
    case "downloading": {
      const p = model.progress;
      const fraction = p?.total ? p.loaded / p.total : 0;
      return (
        <div className="grid w-56 gap-1 text-center tabular-nums" role="status">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/70 transition-[width] duration-150" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
          </div>
          <span>{p?.total ? `${p.network ? "Downloading" : "Loading from cache"} ${mb(p.loaded)} / ${mb(p.total)}` : "Preparing…"}</span>
        </div>
      );
    }
    case "loading":
      return <p role="status">Starting the model…</p>;
    case "ready": {
      const a = model.active!;
      return (
        <p role="status">
          Ready · {BUILD_NAMES[a.build]} · {a.device === "gpu" ? "GPU" : "CPU"}
          {a.note ? ` · ${a.note}` : ""}
        </p>
      );
    }
    case "error":
      return (
        <div className="grid justify-items-center gap-1" role="alert">
          <p className="text-destructive">Couldn&apos;t load the model: {model.error}</p>
          <Button size="sm" variant="outline" onClick={laya.load}>Retry</Button>
        </div>
      );
  }
}
