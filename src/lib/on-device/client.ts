"use client";

import { TypeSafeClient } from "@typesafe-ai/sdk";
import { useSyncExternalStore } from "react";
import { classify } from "@/lib/jev/classify";
import type { SystemOneResponse } from "./laya-core";
import {
  GPU_BUILDS,
  type Build,
  type BuildInfo,
  type Device,
  type FromWorker,
  type ModelId,
  type ModelSource,
  type ToWorker,
} from "./protocol";

const HUB = process.env.NEXT_PUBLIC_HF_HUB || "https://huggingface.co";
const SOURCES: Record<ModelId, ModelSource> = {
  laya: { model: "laya", base: process.env.NEXT_PUBLIC_LAYA_MODEL_BASE || `${HUB}/VishalMysore/layaForWebTrained/resolve/main/` },
  tev1: { model: "tev1", hub: HUB, repo: process.env.NEXT_PUBLIC_TEV1_REPO || "goldenfox/tev1-0.8b-decision-onnx" },
};

export const MODEL_NAMES: Record<ModelId, string> = { laya: "Laya", tev1: "Tev1 0.8B" };
const DEFAULT_BUILD: Record<ModelId, Build> = { laya: "q4e8", tev1: "int4" };
// Tev1 is the default: on pastewise's test pastes it reads kind and cause far more accurately than Laya.
const DEFAULT_MODEL: ModelId = "tev1";

// v3: the on-device model is a choice (Laya or Tev1), and downloaded builds are remembered per model.
const SETTINGS_KEY = "pastewise.on-device.v3";

export type OnDeviceStatus = "idle" | "downloading" | "loading" | "ready" | "error";

export type Catalog = { builds: BuildInfo[]; checkpoint: string | null };

export type OnDeviceState = {
  status: OnDeviceStatus;
  model: ModelId;
  build: Build;
  device: Device;
  /** Each model's builds and source checkpoint, once its listing has loaded. */
  catalogs: Partial<Record<ModelId, Catalog>>;
  gpuAvailable: boolean | null;
  progress: { loaded: number; total: number; network: boolean } | null;
  /** What the running session actually uses; the device differs from the setting when the GPU couldn't be used. */
  active: { model: ModelId; build: Build; device: Device; note: string | null } | null;
  error: string | null;
  /** `model:build` keys this browser has downloaded before; loading one reads Cache Storage instead of the network. */
  cached: string[];
};

export const cacheKey = (model: ModelId, build: Build) => `${model}:${build}`;

/** `device` is only set when the visitor picked one; otherwise the GPU is used whenever the browser has one. */
type Saved = { model: ModelId; builds: Record<ModelId, Build>; device: Device | null; downloaded: string[] };

const isLayaBuild = (b: unknown): b is Build => b === "q4e8" || b === "q8e8";

function readSaved(): Saved {
  const fallback: Saved = { model: DEFAULT_MODEL, builds: { ...DEFAULT_BUILD }, device: null, downloaded: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (raw) {
      const model: ModelId = raw.model === "laya" || raw.model === "tev1" ? raw.model : DEFAULT_MODEL;
      const device: Device | null = raw.device === "cpu" || raw.device === "gpu" ? raw.device : null;
      const builds = { ...DEFAULT_BUILD, laya: isLayaBuild(raw.builds?.laya) ? raw.builds.laya : DEFAULT_BUILD.laya };
      const downloaded = Array.isArray(raw.downloaded) ? raw.downloaded.filter((k: unknown) => typeof k === "string") : [];
      return { model, builds, device, downloaded };
    }
    // Carry over the Laya-only v2 settings.
    const v2 = JSON.parse(localStorage.getItem("pastewise.laya.v2") ?? "null");
    if (v2) {
      const build = isLayaBuild(v2.build) ? v2.build : DEFAULT_BUILD.laya;
      const device: Device | null = v2.device === "cpu" || v2.device === "gpu" ? v2.device : null;
      const downloaded = Array.isArray(v2.downloaded) ? v2.downloaded.filter(isLayaBuild).map((b: Build) => cacheKey("laya", b)) : [];
      return { model: DEFAULT_MODEL, builds: { ...DEFAULT_BUILD, laya: build }, device, downloaded };
    }
  } catch {}
  return fallback;
}

function writeSaved() {
  if (!saved) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    localStorage.removeItem("pastewise.laya.v2");
  } catch {}
}

const SERVER_STATE: OnDeviceState = {
  status: "idle", model: DEFAULT_MODEL, build: DEFAULT_BUILD[DEFAULT_MODEL], device: "gpu", catalogs: {}, gpuAvailable: null, progress: null, active: null, error: null, cached: [],
};

let state: OnDeviceState = SERVER_STATE;
let saved: Saved | null = null;
let worker: Worker | null = null;
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: (r: SystemOneResponse) => void; reject: (e: Error) => void }>();
let nextId = 0;

/** GPU by default when the browser has one and the build supports it; CPU only when picked, forced, or no GPU. */
function effectiveDevice(build: Build, picked: Device | null, gpuAvailable: boolean | null): Device {
  if (!GPU_BUILDS.includes(build) || gpuAvailable === false) return "cpu";
  return picked ?? "gpu";
}

function set(patch: Partial<OnDeviceState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function send(msg: ToWorker) {
  getWorker().postMessage(msg);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    switch (msg.type) {
      case "catalog":
        return set({
          catalogs: { ...state.catalogs, [msg.model]: { builds: msg.builds, checkpoint: msg.checkpoint } },
          gpuAvailable: msg.gpu,
          device: effectiveDevice(state.build, saved?.device ?? null, msg.gpu),
        });
      case "catalogError":
        // Only the selected model's listing failing is worth showing; the other one is retried when it's picked.
        return msg.model === state.model && state.status === "idle" ? set({ status: "error", error: msg.message }) : undefined;
      case "progress":
        return set({ status: "downloading", progress: { loaded: msg.loaded, total: msg.total, network: msg.network } });
      case "loading":
        return set({ status: "loading", progress: null });
      case "ready": {
        const key = cacheKey(msg.model, msg.build);
        const cached = state.cached.includes(key) ? state.cached : [...state.cached, key];
        if (saved) saved = { ...saved, downloaded: cached };
        writeSaved();
        return set({ status: "ready", progress: null, error: null, cached, active: { model: msg.model, build: msg.build, device: msg.device, note: msg.note } });
      }
      case "error":
        return set({ status: "error", progress: null, active: null, error: msg.message });
      case "result":
        pending.get(msg.id)?.resolve(msg.response);
        return pending.delete(msg.id);
      case "failed":
        pending.get(msg.id)?.reject(new Error(msg.message));
        return pending.delete(msg.id);
    }
  };
  worker.onerror = (e) => set({ status: "error", active: null, error: e.message || "the model worker crashed" });
  return worker;
}

let initialized = false;

/** Reads saved settings and fetches both models' build lists. A model itself only loads when the visitor asks for it. */
function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    localStorage.removeItem("pastewise.laya");
  } catch {}
  saved = readSaved();
  const build = saved.builds[saved.model];
  set({ model: saved.model, build, device: effectiveDevice(build, saved.device, null), cached: saved.downloaded });
  send({ type: "catalog", source: SOURCES.laya });
  send({ type: "catalog", source: SOURCES.tev1 });
}

function load() {
  set({ status: "downloading", progress: null, error: null, active: null });
  send({ type: "load", source: SOURCES[state.model], build: state.build, device: state.device });
}

function change(patch: { model?: ModelId; build?: Build; device?: Device }) {
  if (!saved) return;
  const model = patch.model ?? state.model;
  const build = patch.build ?? (patch.model ? saved.builds[model] : state.build);
  // Only an explicit device choice is remembered; picking a CPU-only build doesn't overwrite it.
  const picked = patch.device ?? saved.device;
  const device = effectiveDevice(build, picked, state.gpuAvailable);
  saved = { ...saved, model, builds: { ...saved.builds, [model]: build }, device: picked };
  writeSaved();
  if (model === state.model && build === state.build && device === state.device) return;
  const wasLoaded = state.status !== "idle";
  set({ model, build, device });
  if (patch.model && !state.catalogs[model]) send({ type: "catalog", source: SOURCES[model] });
  // Switching device, or to a model and build already in the cache, restarts right away. Anything that would have to
  // be downloaded waits for the visitor to press the download button.
  if (wasLoaded && state.cached.includes(cacheKey(model, build))) load();
  else set({ status: "idle", active: null, progress: null, error: null });
}

export const onDevice = {
  load,
  setModel: (model: ModelId) => change({ model }),
  setBuild: (build: Build) => change({ build }),
  setDevice: (device: Device) => change({ device }),
};

export function useOnDevice(): OnDeviceState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      init();
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}

/** A fetch for the TypeSafe SDK that answers POST /v1/systemone with the on-device model, instead of the network. */
export const onDeviceFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/v1/systemone") || init?.method !== "POST") {
    return Response.json({ error: `The on-device model only serves POST /v1/systemone, not ${url}` }, { status: 404 });
  }
  if (state.status !== "ready") return Response.json({ error: "No on-device model is loaded" }, { status: 503 });
  const body = JSON.parse(String(init.body));
  const signal = init.signal;
  signal?.throwIfAborted();
  const id = ++nextId;
  const response = await new Promise<SystemOneResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener(
      "abort",
      () => {
        pending.delete(id);
        send({ type: "cancel", id });
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    send({ type: "systemOne", id, body: { state: body.state, questions: body.questions } });
  });
  return Response.json(response);
};

let client: TypeSafeClient | null = null;

function getClient() {
  client ??= new TypeSafeClient({
    apiKey: "on-device",
    baseURL: "https://on-device.local",
    dangerouslyAllowBrowser: true,
    fetch: onDeviceFetch,
    defaultModel: "on-device",
    retry: { maxRetries: 0 },
    timeout: 60000,
  });
  return client;
}

/** The shared classification, answered by whichever on-device model is loaded. */
export const classifyOnDevice = (text: string, signal?: AbortSignal) => classify(getClient(), text, signal);
