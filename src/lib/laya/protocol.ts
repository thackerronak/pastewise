import type { SystemOneResponse } from "./core";

export type Build = "q4e8" | "q8e8";
export type Device = "gpu" | "cpu";

/** The 8-bit build has no WebGPU kernel (ONNX Runtime's MatMulNBits on WebGPU is 2- and 4-bit only). */
export const GPU_BUILDS: readonly Build[] = ["q4e8"];

export type BuildInfo = { key: Build; label: string; bytes: number };

export type ToWorker =
  | { type: "manifest"; base: string }
  | { type: "load"; base: string; build: Build; device: Device }
  | { type: "systemOne"; id: number; body: { state: unknown; questions: unknown } }
  | { type: "cancel"; id: number };

export type FromWorker =
  /** `source` is the Hugging Face checkpoint the builds were converted from, e.g. convaiinnovations/laya-typed-decisions. */
  | { type: "manifest"; builds: BuildInfo[]; gpu: boolean; source: string | null }
  | { type: "progress"; loaded: number; total: number; network: boolean }
  | { type: "loading" }
  /** `note` explains a setup other than the one asked for (no WebGPU, GPU failed to start, single-threaded CPU). */
  | { type: "ready"; build: Build; device: Device; note: string | null }
  | { type: "error"; message: string }
  | { type: "result"; id: number; response: SystemOneResponse }
  | { type: "failed"; id: number; message: string };
