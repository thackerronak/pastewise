# pastewise

**Paste anything. Get the right tool.** One box that recognises what you pasted and turns into the tool for it.

```
{"user":{"id":42}}                    →  formatted JSON, TypeScript types, minified
eyJhbGciOiJIUzI1NiJ9…                  →  decoded JWT with expiry status
*/15 9-17 * * 1-5                     →  "Every 15 minutes, 9 AM–5:59 PM, Mon–Fri" + next runs
TypeError: Cannot read … 'map'        →  message, likely cause, your frames vs. library frames
#ff6b35                               →  HEX / RGB / HSL + WCAG contrast
1758000000                            →  local, UTC, relative time
https://…?q=shoes&size=42             →  URL parts and a query table
select … from users …                 →  formatted SQL
aGVsbG8gd29ybGQ=                      →  decoded base64
```

## How it works

Exact formats (JSON, JWT, URL, timestamp, color, cron, base64, SQL) are detected in the browser with plain rules: instant, no network.

Anything the rules can't pin down goes to a decision model, which answers three typed questions in one pass: is this a stack trace, code or prose; which language; and, for errors, the most likely root cause. The tool itself is always deterministic code. You pick the model under the paste box:

- **On-device** (default). A model runs in your browser through ONNX Runtime Web; nothing you paste leaves the page. It downloads once when you ask, then loads from the browser cache, and runs on the GPU (WebGPU) or the CPU (WASM). Two models to pick from:
  - **Tev1 0.8B** (default): [Together AI's Tev1-0.8B-experimental](https://huggingface.co/togethercomputer/Tev1-0.8B-experimental), a Jev-inspired decision model, through the [goldenfox ONNX build](https://huggingface.co/goldenfox/tev1-0.8b-decision-onnx) (int4, 769 MB). The most accurate of the two on stack traces and code, but slower: a few seconds per paste on a GPU. Its license is still being finalized.
  - **Laya**: [Laya](https://github.com/NandhaKishorM/laya)'s typed-decisions checkpoint, through the [layaForWeb](https://github.com/vishalmysore/layaForWeb) build: int4 (291 MB, GPU or CPU) or int8 (442 MB, CPU only). Faster, less accurate.
- **Jev · cloud**. [TypeSafe AI](https://typesafe.ai)'s Jev model, with your own API key. The key is kept only in the open tab and sent with each request; it is never stored, so a refresh asks for it again.

All of them go through the same TypeSafe SDK and the same questions, in one shared `classify` call: on-device, the SDK's `fetch` is answered by the model in a Web Worker instead of the network. Tev1 answers each question with one option letter, read from a single forward pass, and the paste is processed once for all three questions. Without a model, exact formats still work and the page says what to download or enter. Jev requests go through `/api/classify` because TypeSafe's API doesn't accept calls straight from the browser.

## Run it

Requires [Bun](https://bun.sh).

```bash
bun install
bun dev
```

No keys or env vars are needed. `.env.example` lists the optional ones (other model hosts, a pinned Jev version).

## Layout

```
src/
  lib/detect/             rules for exact formats
  lib/jev/                the typed questions, the shared classify call, and the Jev server client
  lib/on-device/          models in the browser: worker, SDK bridge, Laya core (port of layaForWeb), Tev1 core
  lib/tools/              pure helpers: JSON → TS, JWT, cron, color, stack parsing…
  app/api/classify/       POST { text } + the visitor's key → Jev's kind, language, cause
  hooks/use-detection.ts  rules first, then the on-device model or Jev
  components/tools/       one component per kind, plus the registry
  components/paste/       the workspace, kind badge, samples
```

Adding a tool: add the kind to `lib/detect/types.ts`, a rule or question option for it, a component in `components/tools/`, and a case in `registry.tsx`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Start the dev server |
| `bun run check` | Typecheck, lint and test |
| `bun run build` | Production build |

## Credits

Laya by ConvAI Innovations and layaForWeb by Vishal Mysore, both Apache-2.0. Tev1 by Together AI, ONNX build by goldenfox. See [NOTICE.md](NOTICE.md).
