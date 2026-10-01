import type { SystemOneResponse } from "./laya-core";

/** The models that run in the browser. Both answer the same TypeSafe questions; only the runtime behind them differs. */
export type ModelId = "laya" | "tev1";
/** Laya ships an int4 and an int8 build; the Tev1 ONNX build is a single int4 file. */
export type Build = "q4e8" | "q8e8" | "int4";
export type Device = "gpu" | "cpu";

/** Where each model's files come from. Laya reads layaForWeb's manifest; Tev1 reads the Hugging Face API for sizes. */
export type ModelSource = { model: "laya"; base: string } | { model: "tev1"; hub: string; repo: string };

/** Laya's 8-bit build has no WebGPU kernel (ONNX Runtime's MatMulNBits on WebGPU is 2- and 4-bit only). */
export const GPU_BUILDS: readonly Build[] = ["q4e8", "int4"];

export type BuildInfo = { key: Build; label: string; bytes: number };

export type ToWorker =
  | { type: "catalog"; source: ModelSource }
  | { type: "load"; source: ModelSource; build: Build; device: Device }
  | { type: "systemOne"; id: number; body: { state: unknown; questions: unknown } }
  | { type: "cancel"; id: number };

export type FromWorker =
  /** `checkpoint` is the Hugging Face model the builds were converted from, e.g. convaiinnovations/laya-typed-decisions. */
  | { type: "catalog"; model: ModelId; builds: BuildInfo[]; gpu: boolean; checkpoint: string | null }
  | { type: "catalogError"; model: ModelId; message: string }
  | { type: "progress"; loaded: number; total: number; network: boolean }
  | { type: "loading" }
  /** `note` explains a setup other than the one asked for (no WebGPU, GPU failed to start, single-threaded CPU). */
  | { type: "ready"; model: ModelId; build: Build; device: Device; note: string | null }
  | { type: "error"; message: string }
  | { type: "result"; id: number; response: SystemOneResponse }
  | { type: "failed"; id: number; message: string };
