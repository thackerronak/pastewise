import type * as Ort from "onnxruntime-web";
import { Tokenizer } from "@huggingface/tokenizers";
import { Laya, type LayaConfig, type Question, type SystemOneResponse } from "./laya-core";
import { Tev1 } from "./tev1-core";
import { GPU_BUILDS, type Build, type BuildInfo, type Device, type FromWorker, type ModelId, type ModelSource, type ToWorker } from "./protocol";

type Runtime = typeof Ort;

// Each device gets the ONNX Runtime bundle that can run both models on it, loaded on first use:
// - GPU: the WebGPU bundle, whose native WebGPU backend runs 8-bit MatMulNBits (Tev1 keeps a few layers in int8). The
//   "all" bundle's older WebGPU backend only takes 2- and 4-bit, and can't build Tev1's graph.
// - CPU: the plain WASM bundle, with the full CPU kernel set. The WebGPU bundle's CPU backend lacks GatherBlockQuantized
//   (Tev1's int4 embeddings), so it can't build Tev1's graph either.
const runtimes: Partial<Record<Device, Promise<Runtime>>> = {};

function runtime(device: Device): Promise<Runtime> {
  runtimes[device] ??= (device === "gpu" ? import("onnxruntime-web/webgpu") : import("onnxruntime-web/wasm")).then((ort) => {
    // The .wasm binaries come from the CDN at exactly the version of the JS bundled here, so the two can't drift.
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    return ort as Runtime;
  });
  return runtimes[device]!;
}

type Manifest = {
  source?: string;
  chunk_bytes: number;
  variants: Record<string, { label: string; onnx: string; data: { name: string; size: number; sha256: string; parts: string[] } }>;
};

const post = (msg: FromWorker) => self.postMessage(msg);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Turns the errors people actually hit into something they can act on. */
function explain(err: unknown) {
  const raw = message(err);
  if (err instanceof TypeError && /fetch|network|load failed/i.test(raw))
    return "Couldn't reach the model host. Check your connection and retry.";
  if (/HTTP 404/.test(raw)) return "The model files weren't found on the host.";
  if (/HTTP (5\d\d|429)/.test(raw)) return "The model host is busy or down. Retry in a moment.";
  if (/checksum|got \d+ of \d+ bytes/.test(raw)) return "The download was corrupted. Retry; if it keeps failing, clear this site's data.";
  if (err instanceof RangeError || /out of memory|allocation|memory access out of bounds/i.test(raw))
    return "Not enough memory for this build. Close other tabs or try the int4 build.";
  if (/wasm|webassembly/i.test(raw) && /fetch|compile|instantiate/i.test(raw))
    return "Couldn't load ONNX Runtime from the CDN. Check that cdn.jsdelivr.net isn't blocked, then retry.";
  return raw;
}

/** What either model needs to answer: the TypeSafe systemOne call, run on-device. */
type Engine = { systemOne(state: never, questions: Record<string, Question>): Promise<SystemOneResponse> };

/** One downloadable build: its graph, its weights (as parts, each cached), and how to turn a session into an engine. */
type Files = {
  base: string;
  graph: string;
  data: { name: string; size: number; sha256: string; parts: string[] };
  chunk: number;
  engine: (ort: Runtime, s: Ort.InferenceSession, tok: Tokenizer) => Promise<Engine>;
};

type Catalog = { builds: BuildInfo[]; checkpoint: string | null; files: (build: Build) => Files };

let engine: Engine | null = null;
let session: Ort.InferenceSession | null = null;
let activeDevice: Device | null = null;
const catalogs = new Map<string, Promise<Catalog>>();

const sourceKey = (s: ModelSource) => (s.model === "laya" ? `laya:${s.base}` : `tev1:${s.hub}/${s.repo}`);

function getCatalog(source: ModelSource) {
  const key = sourceKey(source);
  let c = catalogs.get(key);
  if (!c) {
    c = (source.model === "laya" ? layaCatalog(source.base) : tev1Catalog(source.hub, source.repo)).catch((err) => {
      catalogs.delete(key);
      throw err;
    });
    catalogs.set(key, c);
  }
  return c;
}

// Laya: layaForWeb's manifest lists the builds, each split into 24 MiB parts with a SHA-256.
async function layaCatalog(base: string): Promise<Catalog> {
  const m = await fetchJson<Manifest>(base + "manifest.json");
  const name = m.source?.split("/").pop() || "laya";
  return {
    checkpoint: m.source ?? null,
    builds: Object.entries(m.variants).map(([key, v]) => ({ key: key as Build, label: v.label, bytes: v.data.size })),
    files: (build) => {
      const v = m.variants[build];
      if (!v) throw new Error(`the model repo has no ${build} build`);
      return {
        base,
        graph: v.onnx,
        data: v.data,
        chunk: m.chunk_bytes,
        engine: async (ort, s, tok) => {
          const laya = new Laya(ort, s, tok, await fetchJson<LayaConfig>(base + "rl_agent_config.json"), name);
          await laya.systemOne("warm up", { w: { type: "noul", instructions: "This is a warm-up call" } });
          return laya;
        },
      };
    },
  };
}

type HubModel = {
  cardData?: { base_model?: string | string[] };
  siblings: { rfilename: string; size?: number; lfs?: { sha256?: string } }[];
};

type GenaiConfig = { model: { decoder: { head_size: number } } };

// Tev1: one int4 ONNX file in a plain Hugging Face repo. Its size and SHA-256 come from the Hub API.
async function tev1Catalog(hub: string, repo: string): Promise<Catalog> {
  const info = await fetchJson<HubModel>(`${hub}/api/models/${repo}?blobs=true`);
  const files = `${hub}/${repo}/resolve/main/`;
  const data = info.siblings.find((f) => f.rfilename === "model.onnx.data");
  if (!data?.size || !data.lfs?.sha256) throw new Error(`${repo} has no model.onnx.data`);
  const base = info.cardData?.base_model;
  return {
    checkpoint: (Array.isArray(base) ? base[0] : base) ?? "togethercomputer/Tev1-0.8B-experimental",
    builds: [{ key: "int4", label: "int4 weights", bytes: data.size }],
    files: (build) => {
      if (build !== "int4") throw new Error(`Tev1 has no ${build} build`);
      return {
        base: files,
        graph: "model.onnx",
        data: { name: "model.onnx.data", size: data.size!, sha256: data.lfs!.sha256!, parts: ["model.onnx.data"] },
        chunk: data.size!,
        engine: async (ort, s, tok) => {
          // The attention cache's last dimension is symbolic in the graph; the builder's config has its value.
          const { head_size } = (await fetchJson<GenaiConfig>(files + "genai_config.json")).model.decoder;
          const tev1 = new Tev1(ort, s, tok, "tev1-0.8b", { kv_cache_dim: head_size });
          await tev1.systemOne("warm up", { w: { type: "choice", instructions: "Is this a warm-up?", criteria: { yes: "Yes", no: "No" } } });
          return tev1;
        },
      };
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(url: string, onChunk: (n: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onChunk(value.length);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function hasGpu() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

// Weights come as parts (Laya: 24 MiB each; Tev1: one file). Parts are cached in Cache Storage under the build's hash,
// each one's length is checked as it arrives, and the stitched file must match the published SHA-256: truncated downloads
// do happen.
async function fetchWeights(model: ModelId, base: string, entry: Files["data"], chunk: number) {
  const cacheName = `${model}-${entry.sha256.slice(0, 16)}`;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(cacheName);
  } catch {}
  const expected = (i: number) => (i < entry.parts.length - 1 ? chunk : entry.size - chunk * (entry.parts.length - 1));

  let loaded = 0;
  let network = false;
  const report = () => post({ type: "progress", loaded, total: entry.size, network });

  const part = async (i: number, fresh: boolean) => {
    const url = base + entry.parts[i];
    if (!fresh && cache) {
      const hit = await cache.match(url).catch(() => undefined);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if (bytes.length === expected(i)) return bytes;
      }
    }
    network = true;
    const bytes = await fetchBytes(url, (n) => {
      loaded += n;
      report();
    });
    if (bytes.length !== expected(i)) throw new Error(`${entry.parts[i]}: got ${bytes.length} of ${expected(i)} bytes`);
    await cache?.put(url, new Response(bytes)).catch(() => {});
    return bytes;
  };

  const assemble = async (fresh: boolean) => {
    const out = new Uint8Array(entry.size);
    loaded = 0;
    for (let i = 0; i < entry.parts.length; i++) {
      const before = loaded;
      let bytes: Uint8Array;
      try {
        bytes = await part(i, fresh);
      } catch {
        loaded = before;
        bytes = await part(i, true);
      }
      out.set(bytes, chunk * i);
      loaded = before + bytes.length;
      report();
    }
    return out;
  };

  let data = await assemble(false);
  if (hex(await crypto.subtle.digest("SHA-256", data)) !== entry.sha256) {
    if (cache) await caches.delete(cacheName).catch(() => {});
    try {
      cache = await caches.open(cacheName);
    } catch {}
    data = await assemble(true);
    if (hex(await crypto.subtle.digest("SHA-256", data)) !== entry.sha256) throw new Error("model weights failed their checksum");
  }
  return data;
}

async function load(source: ModelSource, build: Build, want: Device) {
  const files = (await getCatalog(source)).files(build);

  // The UI never offers GPU for Laya's int8 build (no 8-bit WebGPU kernel), but a stale setting could still ask for it.
  const gpuBuild = GPU_BUILDS.includes(build);
  const gpu = want === "gpu" && gpuBuild && (await hasGpu());
  let device: Device = gpu ? "gpu" : "cpu";
  let note: string | null = null;
  if (want === "gpu" && !gpuBuild) note = "int8 runs on CPU only.";
  else if (want === "gpu" && !gpu) note = "GPU not available in this browser, using CPU.";

  const [tj, tc, graph, data] = await Promise.all([
    fetchJson<object>(files.base + "tokenizer.json"),
    fetchJson<object>(files.base + "tokenizer_config.json"),
    fetch(files.base + files.graph).then(async (r) => {
      if (!r.ok) throw new Error(`${files.graph}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }),
    fetchWeights(source.model, files.base, files.data, files.chunk),
  ]);

  post({ type: "loading" });
  engine = null;
  await session?.release().catch(() => {});
  session = null;
  const tokenizer = new Tokenizer(tj, tc);

  const start = async (on: Device) => {
    const ort = await runtime(on);
    const s = await ort.InferenceSession.create(graph, {
      executionProviders: on === "gpu" ? ["webgpu"] : ["wasm"],
      graphOptimizationLevel: "all",
      externalData: [{ path: files.data.name, data }],
    });
    try {
      return { s, next: await files.engine(ort, s, tokenizer) };
    } catch (err) {
      await s.release().catch(() => {});
      throw err;
    }
  };

  // A WebGPU adapter can exist and still fail to build or run the graph (drivers, missing features): fall back to CPU.
  let started: Awaited<ReturnType<typeof start>>;
  try {
    started = await start(device);
  } catch (err) {
    if (device !== "gpu") throw err;
    console.warn(`[${source.model}] WebGPU failed, falling back to CPU:`, message(err));
    device = "cpu";
    note = "GPU failed to start, using CPU.";
    started = await start("cpu");
  }
  session = started.s;
  engine = started.next;
  const notes = [note];
  if (device === "cpu" && source.model === "tev1") notes.push("Tev1 on CPU takes several seconds per paste.");
  if (device === "cpu" && !self.crossOriginIsolated) notes.push("CPU is running on one thread, so it's slower.");
  activeDevice = device;
  post({ type: "ready", model: source.model, build, device, note: notes.filter(Boolean).join(" ") || null });
}

// One inference at a time: ONNX Runtime sessions don't take concurrent runs. A request cancelled while it waits in the
// queue is skipped; one already running can't be interrupted, and its result is simply ignored by the caller.
let queue = Promise.resolve();
const cancelled = new Set<number>();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "catalog") {
    Promise.all([getCatalog(msg.source), hasGpu()])
      .then(([c, gpu]) => post({ type: "catalog", model: msg.source.model, builds: c.builds, gpu, checkpoint: c.checkpoint }))
      .catch((err) => post({ type: "catalogError", model: msg.source.model, message: explain(err) }));
  } else if (msg.type === "load") {
    queue = queue.then(() => load(msg.source, msg.build, msg.device)).catch((err) => post({ type: "error", message: explain(err) }));
  } else if (msg.type === "cancel") {
    cancelled.add(msg.id);
  } else {
    const { id, body } = msg;
    queue = queue.then(async () => {
      if (cancelled.delete(id)) return;
      try {
        if (!engine) throw new Error("model is not loaded");
        const response = await engine.systemOne(body.state as never, body.questions as Record<string, Question>);
        post({ type: "result", id, response });
      } catch (err) {
        post({ type: "failed", id, message: message(err) });
        // A GPU that stops mid-session (device lost, driver reset) won't recover: drop the model so the page asks
        // for it again, instead of failing every paste.
        if (activeDevice === "gpu") {
          engine = null;
          await session?.release().catch(() => {});
          session = null;
          activeDevice = null;
          post({ type: "error", message: "The GPU stopped responding. Switch to CPU, or retry." });
        }
      } finally {
        cancelled.delete(id);
      }
    });
  }
};
