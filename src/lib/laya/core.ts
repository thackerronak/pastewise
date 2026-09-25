// Laya (English) in the browser: sequence builder, ONNX Runtime Web inference, calibrated outputs.
// A TypeScript port of laya-core.js from layaForWeb (https://github.com/vishalmysore/layaForWeb), itself a port of
// laya/common.py (build_sequence) and laya/agent.py (system_one).
//
// Derived from Laya by ConvAI Innovations (https://github.com/NandhaKishorM/laya), licensed under the Apache License,
// Version 2.0 (see NOTICE.md and licenses/APACHE-2.0.txt). Changed: ported to TypeScript, and the reported model name is a
// constructor argument.

import type * as Ort from "onnxruntime-web";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Question =
  | { type: "choice"; instructions: Json; criteria: Record<string, Json> | string[] }
  | { type: "score"; instructions: Json; criteria: Json[] }
  | { type: "noul"; instructions: Json; criteria?: { true?: Json; false?: Json } | null };

type Internal =
  | { t: "choice"; ins: string; crit: Record<string, Json> }
  | { t: "score"; ins: string; crit: Json[] }
  | { t: "noul"; ins: string; crit: { true?: Json; false?: Json } | null | undefined };

export interface TokenizerLike {
  token_to_id(token: string): number | undefined;
  encode(text: string, options: { add_special_tokens: boolean }): { ids: ArrayLike<number> };
}

export type LayaConfig = {
  max_len?: number;
  head_max_len?: number;
  temperature: number[];
  temperature_by_options?: Record<string, number | string>;
};

type Special = { cls: number; sep: number; mask: number; pad: number };

const MASK = "[MASK]";
const QTYPES = { choice: 0, score: 1, noul: 2 } as const;
const QTYPE_NAMES = ["choice", "score", "noul"] as const;

// Python's json.dumps(..., ensure_ascii=False) uses ", " and ": " separators; JS JSON.stringify uses none.
export function pyDumps(v: Json | undefined): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pyDumps).join(", ") + "]";
  return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + pyDumps(x)).join(", ") + "}";
}
const serializeState = (s: Json) => (typeof s === "string" ? s : pyDumps(s));
const renderCriterion = (v: Json) => (typeof v === "string" ? v : pyDumps(v));
const blank = (v: Json | undefined) => v === null || v === undefined || v === "";

export function toInternal(q: Question): Internal {
  const ins = typeof q.instructions === "string" ? q.instructions : pyDumps(q.instructions);
  if (q.type === "choice") {
    const crit = Array.isArray(q.criteria) ? Object.fromEntries(q.criteria.map((c) => [c, null])) : q.criteria;
    return { t: "choice", ins, crit };
  }
  if (q.type === "score") return { t: "score", ins, crit: q.criteria };
  return { t: "noul", ins, crit: q.criteria };
}

export function renderOptions(q: Internal): string[] {
  if (q.t === "choice") return Object.entries(q.crit).map(([k, v]) => (blank(v) ? k : `${k}: ${renderCriterion(v)}`));
  if (q.t === "score") return q.crit.map((c, i) => `level ${i}: ${renderCriterion(c)}`);
  const f = q.crit?.false, t = q.crit?.true;
  return [
    "false: " + (blank(f) ? "no, the statement does not hold" : renderCriterion(f!)),
    "true: " + (blank(t) ? "yes, the statement holds" : renderCriterion(t!)),
  ];
}

export function specialIds(tok: TokenizerLike): Special {
  const g = (t: string) => {
    const id = tok.token_to_id(t);
    if (id === undefined) throw new Error(`tokenizer has no ${t} token`);
    return id;
  };
  return { cls: g("[CLS]"), sep: g("[SEP]"), mask: g("[MASK]"), pad: g("[PAD]") };
}

export function buildSequence(tok: TokenizerLike, sp: Special, state: Json, q: Internal, maxLen = 512, headMaxLen = 192) {
  const enc = (t: string) => Array.from(tok.encode(t, { add_special_tokens: false }).ids);
  const opts = renderOptions(q);
  const ins = String(q.ins).split(MASK).join(" ");
  let headIds = enc(`${q.t} question: ${ins}`);
  let optIds = opts.map((o) => [sp.mask, ...enc(" " + o.split(MASK).join(" ")).slice(0, 48)]);
  const total = (arr: number[][]) => arr.reduce((a, o) => a + o.length, 0);
  let optBudget = headMaxLen - total(optIds);
  if (optBudget < 16) {
    const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
    optIds = optIds.map((o) => o.slice(0, per));
    optBudget = headMaxLen - total(optIds);
  }
  headIds = headIds.slice(0, Math.max(8, optBudget));
  let ids = [sp.cls, ...headIds, sp.sep];
  const markers: number[] = [];
  for (const o of optIds) {
    markers.push(ids.length);
    ids.push(...o);
  }
  ids.push(sp.sep);
  const room = Math.max(0, maxLen - ids.length - 1);
  const st = enc(serializeState(state).split(MASK).join(" ")).slice(0, room);
  ids = ids.concat(st, [sp.sep]).slice(0, maxLen);
  return { ids, markers: markers.filter((m) => m < maxLen) };
}

export function tempBucket(qt: number, k: number) {
  const size = k <= 2 ? "2" : k <= 5 ? "3-5" : k <= 10 ? "6-10" : "11+";
  return `${QTYPE_NAMES[qt]}:${size}`;
}

// Port of Python's clamp_temperature (laya/common.py): non-numeric, NaN and +-inf fall back to 1.0, everything else is
// clamped into [0.5, 5]. Both shipped checkpoints have choice:11+ = 0.10058, which would otherwise sharpen logits ~10x.
const TEMP_MIN = 0.5, TEMP_MAX = 5.0;
export function clampTemperature(t: unknown) {
  let v: number;
  if (typeof t === "number") v = t;
  else if (typeof t === "string" && t.trim() !== "") v = Number(t);
  else return 1.0;
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, v));
}

export function confidenceFromProbs(p: number[], k: number) {
  if (k < 2) return 1.0;
  let ent = 0;
  for (let i = 0; i < k; i++) ent -= p[i] * Math.log(Math.min(Math.max(p[i], 1e-12), 1.0));
  return Math.min(Math.max(1.0 - ent / Math.log(k), 0.0), 1.0);
}
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

type Item = { ids: number[]; markers: number[]; qtype: number };

export function collate(items: Item[], padId: number) {
  const n = items.length;
  const L = Math.max(...items.map((it) => it.ids.length));
  const kmax = Math.max(...items.map((it) => it.markers.length));
  const ids = new BigInt64Array(n * L).fill(BigInt(padId));
  const att = new BigInt64Array(n * L);
  const mpos = new BigInt64Array(n * kmax);
  const mmask = new Uint8Array(n * kmax);
  const qtype = new BigInt64Array(n);
  items.forEach((it, i) => {
    it.ids.forEach((t, j) => {
      ids[i * L + j] = BigInt(t);
      att[i * L + j] = BigInt(1);
    });
    it.markers.forEach((m, j) => {
      mpos[i * kmax + j] = BigInt(m);
      mmask[i * kmax + j] = 1;
    });
    qtype[i] = BigInt(it.qtype);
  });
  return { n, L, kmax, ids, att, mpos, mmask, qtype };
}

export type Answer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, Json>; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number; confidence: number };

export type SystemOneResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
};

export class Laya {
  private sp: Special;

  constructor(
    private ort: typeof Ort,
    private session: Ort.InferenceSession,
    private tok: TokenizerLike,
    private cfg: LayaConfig,
    private model: string,
  ) {
    this.sp = specialIds(tok);
  }

  async systemOne(state: Json, questions: Record<string, Question>): Promise<SystemOneResponse> {
    const { cfg, ort } = this;
    const qids = Object.keys(questions);
    const items: Item[] = [], qs: Internal[] = [];
    for (const qid of qids) {
      const q = toInternal(questions[qid]);
      const { ids, markers } = buildSequence(this.tok, this.sp, state, q, cfg.max_len ?? 512, cfg.head_max_len ?? 192);
      if (markers.length !== renderOptions(q).length) throw new Error(`question "${qid}": options exceed head_max_len=${cfg.head_max_len ?? 192}`);
      items.push({ ids, markers, qtype: QTYPES[q.t] });
      qs.push(q);
    }
    const b = collate(items, this.sp.pad);
    const feeds = {
      input_ids: new ort.Tensor("int64", b.ids, [b.n, b.L]),
      attention_mask: new ort.Tensor("int64", b.att, [b.n, b.L]),
      marker_pos: new ort.Tensor("int64", b.mpos, [b.n, b.kmax]),
      marker_mask: new ort.Tensor("bool", b.mmask, [b.n, b.kmax]),
      qtype: new ort.Tensor("int64", b.qtype, [b.n]),
    };
    const t0 = performance.now();
    const out = await this.session.run(feeds);
    const ms = performance.now() - t0;
    const logits = out.logits.data as Float32Array; // [n, kmax]
    const answers: Record<string, Answer> = {};
    qids.forEach((qid, r) => {
      const q = qs[r], k = items[r].markers.length, qt = items[r].qtype;
      const tScale = clampTemperature(cfg.temperature_by_options?.[tempBucket(qt, k)] ?? cfg.temperature[qt]);
      const z = Array.from({ length: k }, (_, i) => logits[r * b.kmax + i] / tScale);
      const zmax = Math.max(...z);
      const e = z.map((v) => Math.exp(v - zmax));
      const s = e.reduce((a, v) => a + v, 0);
      const p = e.map((v) => v / s);
      const confidence = r4(confidenceFromProbs(p, k));
      if (q.t === "choice") {
        const keys = Object.keys(q.crit);
        const top = p.indexOf(Math.max(...p));
        answers[qid] = { type: "choice", choice: keys[top], probabilities: Object.fromEntries(keys.map((kk, i) => [kk, r4(p[i])])), confidence };
      } else if (q.t === "score") {
        const score = p.reduce((a, v, i) => a + i * v, 0);
        answers[qid] = {
          type: "score",
          score: r4(score),
          legend: Object.fromEntries(q.crit.map((c, i) => [String(i), c])),
          probabilities: Object.fromEntries(p.map((v, i) => [String(i), r4(v)])),
          confidence,
        };
      } else {
        answers[qid] = { type: "noul", noul: r4(p[1]), confidence: r4(Math.max(p[1], 1 - p[1])) };
      }
    });
    const inputTokens = b.att.reduce((a, v) => a + Number(v), 0);
    return { model: this.model, answers, usage: { input_tokens: inputTokens, output_tokens: 0 }, latency_ms: ms };
  }
}
