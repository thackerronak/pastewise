"use client";

import { TypeSafeClient } from "@typesafe-ai/sdk";
import { useSyncExternalStore } from "react";
import { classify } from "@/lib/jev/classify";
import { GPU_BUILDS, type Build, type BuildInfo, type Device, type FromWorker, type ToWorker } from "./protocol";
import type { SystemOneResponse } from "./core";

const BASE = process.env.NEXT_PUBLIC_LAYA_MODEL_BASE || "https://huggingface.co/VishalMysore/layaForWebTrained/resolve/main/";
// v2: only a device the visitor picked is saved; earlier versions also saved the CPU that int8 forces.
const SETTINGS_KEY = "pastewise.laya.v2";

export type LayaStatus = "idle" | "downloading" | "loading" | "ready" | "error";

export type LayaState = {
  status: LayaStatus;
  build: Build;
  device: Device;
  builds: BuildInfo[] | null;
  /** The checkpoint the hosted builds come from, from the manifest. */
  source: string | null;
  gpuAvailable: boolean | null;
  progress: { loaded: number; total: number; network: boolean } | null;
  /** What the running session actually uses; the device differs from the setting when the GPU couldn't be used. */
  active: { build: Build; device: Device; note: string | null } | null;
  error: string | null;
  /** Builds this browser has downloaded before; loading one of these reads Cache Storage instead of the network. */
  cached: Build[];
};

/** `device` is only set when the visitor picked one; otherwise the GPU is used whenever the browser has one. */
type Saved = { build: Build; device: Device | null; downloaded: Build[] };

function readSaved(): Saved {
  const fallback: Saved = { build: "q4e8", device: null, downloaded: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (!raw) return fallback;
    const build: Build = raw.build === "q8e8" ? "q8e8" : "q4e8";
    const device: Device | null = raw.device === "cpu" || raw.device === "gpu" ? raw.device : null;
    const downloaded = Array.isArray(raw.downloaded) ? raw.downloaded.filter((b: unknown) => b === "q4e8" || b === "q8e8") : [];
    return { build, device, downloaded };
  } catch {
    return fallback;
  }
}

function writeSaved(saved: Saved) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
  } catch {}
}

const SERVER_STATE: LayaState = {
  status: "idle", build: "q4e8", device: "gpu", builds: null, source: null, gpuAvailable: null, progress: null, active: null, error: null, cached: [],
};

let state: LayaState = SERVER_STATE;

/** GPU by default when the browser has one and the build supports it; CPU only when picked, forced, or no GPU. */
function effectiveDevice(build: Build, picked: Device | null, gpuAvailable: boolean | null): Device {
  if (!GPU_BUILDS.includes(build) || gpuAvailable === false) return "cpu";
  return picked ?? "gpu";
}
let saved: Saved | null = null;
let worker: Worker | null = null;
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: (r: SystemOneResponse) => void; reject: (e: Error) => void }>();
let nextId = 0;

function set(patch: Partial<LayaState>) {
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
      case "manifest":
        return set({ builds: msg.builds, gpuAvailable: msg.gpu, source: msg.source, device: effectiveDevice(state.build, saved?.device ?? null, msg.gpu) });
      case "progress":
        return set({ status: "downloading", progress: { loaded: msg.loaded, total: msg.total, network: msg.network } });
      case "loading":
        return set({ status: "loading", progress: null });
      case "ready":
        const cached = state.cached.includes(msg.build) ? state.cached : [...state.cached, msg.build];
        saved = { build: state.build, device: saved?.device ?? null, downloaded: cached };
        writeSaved(saved);
        return set({ status: "ready", progress: null, error: null, cached, active: { build: msg.build, device: msg.device, note: msg.note } });
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

/** Reads saved settings and fetches the build list. The model itself only loads when the visitor asks for it. */
function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    localStorage.removeItem("pastewise.laya");
  } catch {}
  saved = readSaved();
  set({ build: saved.build, device: effectiveDevice(saved.build, saved.device, null), cached: saved.downloaded });
  send({ type: "manifest", base: BASE });
}

function load() {
  set({ status: "downloading", progress: null, error: null, active: null });
  send({ type: "load", base: BASE, build: state.build, device: state.device });
}

function change(patch: Partial<Pick<LayaState, "build" | "device">>) {
  const build = patch.build ?? state.build;
  // Only an explicit device choice is remembered; picking int8 (CPU only) doesn't overwrite it.
  const picked = patch.device ?? saved?.device ?? null;
  const device = effectiveDevice(build, picked, state.gpuAvailable);
  saved = { build, device: picked, downloaded: state.cached };
  writeSaved(saved);
  if (build === state.build && device === state.device) return;
  const wasLoaded = state.status !== "idle";
  set({ build, device });
  // Switching device, or to a build already in the cache, restarts the model right away. A build that would have to be
  // downloaded waits for the visitor to press the download button.
  if (!wasLoaded) return;
  if (state.cached.includes(build)) load();
  else set({ status: "idle", active: null, progress: null, error: null });
}

export const laya = {
  load,
  setBuild: (build: Build) => change({ build }),
  setDevice: (device: Device) => change({ device }),
};

export function useLaya(): LayaState {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      init();
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
  return snapshot;
}

/** A fetch for the TypeSafe SDK that answers POST /v1/systemone with Laya, in the model worker, instead of the network. */
export const layaFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/v1/systemone") || init?.method !== "POST") {
    return Response.json({ error: `Laya only serves POST /v1/systemone, not ${url}` }, { status: 404 });
  }
  if (state.status !== "ready") return Response.json({ error: "Laya is not loaded" }, { status: 503 });
  const body = JSON.parse(String(init.body));
  const signal = init.signal;
  signal?.throwIfAborted();
  const id = ++nextId;
  const response = await new Promise<SystemOneResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener("abort", () => {
      pending.delete(id);
      send({ type: "cancel", id });
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
    send({ type: "systemOne", id, body: { state: body.state, questions: body.questions } });
  });
  return Response.json(response);
};

let client: TypeSafeClient | null = null;

function getClient() {
  client ??= new TypeSafeClient({
    apiKey: "on-device",
    baseURL: "https://laya.local",
    dangerouslyAllowBrowser: true,
    fetch: layaFetch,
    defaultModel: "laya-typed-decisions",
    retry: { maxRetries: 0 },
    timeout: 30000,
  });
  return client;
}

/** The shared classification, answered on-device. */
export const classifyWithLaya = (text: string, signal?: AbortSignal) => classify(getClient(), text, signal);
