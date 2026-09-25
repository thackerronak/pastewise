import * as ort from "onnxruntime-web/webgpu";
import { Tokenizer } from "@huggingface/tokenizers";
import { Laya, type LayaConfig, type Question } from "./core";
import { GPU_BUILDS, type Build, type BuildInfo, type Device, type FromWorker, type ToWorker } from "./protocol";


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

let laya: Laya | null = null;
let session: ort.InferenceSession | null = null;
let manifest: { base: string; value: Manifest } | null = null;
let activeDevice: Device | null = null;

async function getManifest(base: string) {
  if (manifest?.base !== base) manifest = { base, value: await fetchJson<Manifest>(base + "manifest.json") };
  return manifest.value;
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

// The weights are stored as 24 MiB parts. Parts are cached in Cache Storage under the build's hash, each one's length is
// checked as it arrives, and the stitched file must match the manifest's SHA-256: truncated downloads do happen.
async function fetchWeights(base: string, entry: Manifest["variants"][string]["data"], chunk: number) {
  let cache: Cache | null = null;
  try {
    cache = await caches.open("laya-" + entry.sha256.slice(0, 16));
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
    if (cache) await caches.delete("laya-" + entry.sha256.slice(0, 16)).catch(() => {});
    try {
      cache = await caches.open("laya-" + entry.sha256.slice(0, 16));
    } catch {}
    data = await assemble(true);
    if (hex(await crypto.subtle.digest("SHA-256", data)) !== entry.sha256) throw new Error("model weights failed their checksum");
  }
  return data;
}

async function load(base: string, build: Build, want: Device) {
  const m = await getManifest(base);
  const variant = m.variants[build];
  if (!variant) throw new Error(`the model repo has no ${build} build`);

  // The UI never offers GPU for the int8 build (no 8-bit WebGPU kernel), but a stale setting could still ask for it.
  const gpuBuild = GPU_BUILDS.includes(build);
  const gpu = want === "gpu" && gpuBuild && (await hasGpu());
  let device: Device = gpu ? "gpu" : "cpu";
  let note: string | null = null;
  if (want === "gpu" && !gpuBuild) note = "int8 runs on CPU only.";
  else if (want === "gpu" && !gpu) note = "GPU not available in this browser, using CPU.";

  // The .wasm binaries come from the CDN at exactly the version of the JS bundled here, so the two can't drift.
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

  const [tj, tc, cfg, graph, data] = await Promise.all([
    fetchJson<object>(base + "tokenizer.json"),
    fetchJson<object>(base + "tokenizer_config.json"),
    fetchJson<LayaConfig>(base + "rl_agent_config.json"),
    fetch(base + variant.onnx).then(async (r) => {
      if (!r.ok) throw new Error(`${variant.onnx}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }),
    fetchWeights(base, variant.data, m.chunk_bytes),
  ]);

  post({ type: "loading" });
  laya = null;
  await session?.release().catch(() => {});
  session = null;
  const tokenizer = new Tokenizer(tj, tc);

  const start = async (on: Device) => {
    const s = await ort.InferenceSession.create(graph, {
      executionProviders: on === "gpu" ? ["webgpu"] : ["wasm"],
      graphOptimizationLevel: "all",
      externalData: [{ path: variant.data.name, data }],
    });
    const next = new Laya(ort, s, tokenizer, cfg, m.source?.split("/").pop() || "laya");
    try {
      await next.systemOne("warm up", { w: { type: "noul", instructions: "This is a warm-up call" } });
    } catch (err) {
      await s.release().catch(() => {});
      throw err;
    }
    return { s, next };
  };

  // A WebGPU adapter can exist and still fail to build or run the graph (drivers, missing features): fall back to CPU.
  let started: Awaited<ReturnType<typeof start>>;
  try {
    started = await start(device);
  } catch (err) {
    if (device !== "gpu") throw err;
    console.warn("[laya] WebGPU failed, falling back to CPU:", message(err));
    device = "cpu";
    note = "GPU failed to start, using CPU.";
    started = await start("cpu");
  }
  session = started.s;
  laya = started.next;
  if (device === "cpu" && !self.crossOriginIsolated) note = [note, "CPU is running on one thread, so it's slower."].filter(Boolean).join(" ");
  activeDevice = device;
  post({ type: "ready", build, device, note });
}

// One inference at a time: ONNX Runtime sessions don't take concurrent runs. A request cancelled while it waits in the
// queue is skipped; one already running can't be interrupted, and its result is simply ignored by the caller.
let queue = Promise.resolve();
const cancelled = new Set<number>();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "manifest") {
    Promise.all([getManifest(msg.base), hasGpu()])
      .then(([m, gpu]) => {
        const builds = Object.entries(m.variants).map(([key, v]): BuildInfo => ({ key: key as Build, label: v.label, bytes: v.data.size }));
        post({ type: "manifest", builds, gpu, source: m.source ?? null });
      })
      .catch((err) => post({ type: "error", message: explain(err) }));
  } else if (msg.type === "load") {
    queue = queue.then(() => load(msg.base, msg.build, msg.device)).catch((err) => post({ type: "error", message: explain(err) }));
  } else if (msg.type === "cancel") {
    cancelled.add(msg.id);
  } else {
    const { id, body } = msg;
    queue = queue.then(async () => {
      if (cancelled.delete(id)) return;
      try {
        if (!laya) throw new Error("model is not loaded");
        const response = await laya.systemOne(body.state as never, body.questions as Record<string, Question>);
        post({ type: "result", id, response });
      } catch (err) {
        post({ type: "failed", id, message: message(err) });
        // A GPU that stops mid-session (device lost, driver reset) won't recover: drop the model so the page asks
        // for it again, instead of failing every paste.
        if (activeDevice === "gpu") {
          laya = null;
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
