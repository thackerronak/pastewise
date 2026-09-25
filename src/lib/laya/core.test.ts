import { expect, test } from "bun:test";
import { Tokenizer } from "@huggingface/tokenizers";
import { buildSequence, specialIds, toInternal, type Question } from "./core";
// Token sequences produced by Laya's Python reference, from layaForWeb's tests/seq_tests.json (Apache-2.0).
import cases from "./fixtures/seq_tests.json";

const BASE = "https://huggingface.co/VishalMysore/layaForWebTrained/resolve/main/";

async function loadTokenizer() {
  try {
    const [tj, tc] = await Promise.all(
      ["tokenizer.json", "tokenizer_config.json"].map((f) =>
        fetch(BASE + f, { signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      ),
    );
    return new Tokenizer(tj, tc);
  } catch {
    return null;
  }
}

const tok = await loadTokenizer();
if (!tok) console.warn("[laya] tokenizer unavailable (offline?): skipping the sequence parity test");

test.skipIf(!tok)("TypeScript port builds the same token sequences as Laya's Python reference", () => {
  const sp = specialIds(tok!);
  for (const c of cases as { state: never; q: Question; ids: number[]; markers: number[] }[]) {
    const r = buildSequence(tok!, sp, c.state, toInternal(c.q));
    expect(r.ids).toEqual(c.ids);
    expect(r.markers).toEqual(c.markers);
  }
});
