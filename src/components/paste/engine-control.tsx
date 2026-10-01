"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EngineName, useEngine } from "@/hooks/use-engine";
import { cacheKey, MODEL_NAMES, onDevice, type OnDeviceState } from "@/lib/on-device/client";
import { GPU_BUILDS, type Build, type Device, type ModelId } from "@/lib/on-device/protocol";
import { swap } from "@/lib/motion";

const BUILD_NAMES: Record<Build, string> = { q4e8: "int4", q8e8: "int8", int4: "int4" };
const MODELS: readonly ModelId[] = ["tev1", "laya"];

const buildsOf = (model: OnDeviceState) => model.catalogs[model.model]?.builds ?? null;
const sizeOf = (model: OnDeviceState, build: Build) => buildsOf(model)?.find((b) => b.key === build)?.bytes;

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
  const size = sizeOf(model, model.build);
  const cached = model.cached.includes(cacheKey(model.model, model.build));
  const name = MODEL_NAMES[model.model];
  const action =
    engine.engine === "jev" ? (
      <Button size="sm" onClick={() => document.getElementById(KEY_INPUT_ID)?.focus()}>Enter your TypeSafe key</Button>
    ) : model.status === "downloading" || model.status === "loading" ? (
      <p className="text-xs">{name} is loading. This paste will be read as soon as it&apos;s ready.</p>
    ) : (
      <Button size="sm" onClick={onDevice.load}>
        {model.status === "error" ? `Retry ${name}` : cached ? `Load ${name} · cached` : `Download ${name}${size ? ` · ${mb(size)}` : ""}`}
      </Button>
    );
  return (
    <div role="status" className="grid justify-items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">Reading this needs a model</p>
      <p className="text-muted-foreground">
        Stack traces, code and prose are read by a model.{" "}
        {engine.engine === "jev"
          ? "Add your TypeSafe key to use Jev, or switch to On-device to run a model in your browser."
          : `Download ${name} to run it in your browser, or switch to Jev and add your TypeSafe key.`}
      </p>
      {action}
    </div>
  );
}
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

type Props = { engine: ReturnType<typeof useEngine>; model: OnDeviceState };

/** The on-device / Jev switch. It sits above the paste box in every state, so it never moves when the panels change. */
export function EngineTabs({ engine }: Pick<Props, "engine">) {
  return (
    <Tabs value={engine.engine} onValueChange={(v) => engine.choose(v as EngineName)} className="items-center">
      <TabsList aria-label="Model">
        <TabsTrigger value="device" className="px-3 text-xs">On-device</TabsTrigger>
        <TabsTrigger value="jev" className="px-3 text-xs">Jev · cloud</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/** What the selected engine needs or reports: the on-device model, build, device and download, or Jev's key. */
export function EnginePanel({ engine, model }: Props) {
  return (
    <div className="grid justify-items-center gap-2 text-xs text-muted-foreground">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={engine.askingKey ? "key" : engine.engine} {...swap} className="grid justify-items-center gap-2">
          {engine.askingKey ? <KeyForm engine={engine} /> : engine.engine === "device" ? <OnDevicePanel model={model} /> : <JevPanel engine={engine} />}
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
        <Button type="button" size="sm" variant="ghost" onClick={() => engine.choose("device")}>Cancel</Button>
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

const LICENSE_NOTE: Partial<Record<ModelId, string>> = {
  tev1: "Experimental; the license for these weights is still being finalized.",
};

function OnDevicePanel({ model }: { model: OnDeviceState }) {
  const builds = buildsOf(model);
  const checkpoint = model.catalogs[model.model]?.checkpoint;
  const gpuAllowed = GPU_BUILDS.includes(model.build) && model.gpuAvailable !== false;
  const busy = model.status === "downloading" || model.status === "loading";
  const buildLabel = (b: Build) => {
    const size = sizeOf(model, b);
    return `${BUILD_NAMES[b]}${size ? ` · ${mb(size)}` : ""}${GPU_BUILDS.includes(b) ? "" : " · CPU only"}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span>Model</span>
        <Tabs value={model.model} onValueChange={(v) => onDevice.setModel(v as ModelId)}>
          <TabsList aria-label="On-device model" className="h-7!">
            {MODELS.map((m) => (
              <TabsTrigger key={m} value={m} disabled={busy} className="px-2 text-xs">
                {MODEL_NAMES[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {checkpoint && (
          <a
            href={`https://huggingface.co/${checkpoint}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground underline decoration-dotted underline-offset-4"
          >
            {checkpoint}
          </a>
        )}
      </div>
      {LICENSE_NOTE[model.model] && <p>{LICENSE_NOTE[model.model]}</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {builds && builds.length > 1 ? (
          <Tabs value={model.build} onValueChange={(v) => onDevice.setBuild(v as Build)}>
            <TabsList aria-label="Model build" className="h-7!">
              {builds.map(({ key }) => (
                <TabsTrigger key={key} value={key} disabled={busy} className="px-2 text-xs">
                  {buildLabel(key)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          builds && <span className="rounded-md bg-muted px-2 py-1">{buildLabel(model.build)}</span>
        )}
        <Tabs value={gpuAllowed ? model.device : "cpu"} onValueChange={(v) => onDevice.setDevice(v as Device)}>
          <TabsList aria-label="Run on" className="h-7!">
            <TabsTrigger value="gpu" disabled={busy || !gpuAllowed} className="px-2 text-xs">GPU</TabsTrigger>
            <TabsTrigger value="cpu" disabled={busy} className="px-2 text-xs">CPU</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <OnDeviceStatus model={model} size={sizeOf(model, model.build)} />
    </>
  );
}

function OnDeviceStatus({ model, size }: { model: OnDeviceState; size?: number }) {
  const name = MODEL_NAMES[model.model];
  const note = !GPU_BUILDS.includes(model.build)
    ? `${BUILD_NAMES[model.build]} runs on CPU only.`
    : model.gpuAvailable === false
      ? "GPU not available, using CPU."
      : model.model === "tev1" && model.device === "cpu"
        ? "Tev1 on CPU takes several seconds per paste; GPU is much faster."
        : null;

  switch (model.status) {
    case "idle":
      return (
        <div className="grid justify-items-center gap-1">
          <Button size="sm" variant="outline" onClick={onDevice.load}>
            {model.cached.includes(cacheKey(model.model, model.build)) ? `Load ${name} · cached` : `Download ${name}${size ? ` · ${mb(size)}` : ""}`}
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
      return <p role="status">Starting {name}…</p>;
    case "ready": {
      const a = model.active!;
      return (
        <p role="status">
          Ready · {MODEL_NAMES[a.model]} · {BUILD_NAMES[a.build]} · {a.device === "gpu" ? "GPU" : "CPU"}
          {a.note ? ` · ${a.note}` : ""}
        </p>
      );
    }
    case "error":
      return (
        <div className="grid justify-items-center gap-1" role="alert">
          <p className="text-destructive">Couldn&apos;t load {name}: {model.error}</p>
          <Button size="sm" variant="outline" onClick={onDevice.load}>Retry</Button>
        </div>
      );
  }
}
