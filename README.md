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

- **Laya · on-device** (default). [Laya](https://github.com/NandhaKishorM/laya)'s typed-decisions checkpoint runs in your browser through ONNX Runtime Web, using the [layaForWeb](https://github.com/vishalmysore/layaForWeb) build hosted on Hugging Face. Nothing you paste leaves the page. Choose the int4 build (291 MB, GPU or CPU) or the int8 build (442 MB, CPU only), and run it on the GPU (WebGPU) or the CPU (WASM). It downloads once when you ask, then loads from the browser cache.
- **Jev · cloud**. [TypeSafe AI](https://typesafe.ai)'s Jev model, with your own API key. The key is kept only in the open tab and sent with each request; it is never stored, so a refresh asks for it again.

Both go through the same TypeSafe SDK and the same questions, in one shared `classify` call: for Laya, the SDK's `fetch` is answered by the model in a Web Worker instead of the network. Until you download Laya or enter a Jev key, the paste box is covered by a layer that asks you to pick one. Jev requests go through `/api/classify` because TypeSafe's API doesn't accept calls straight from the browser.

## Run it

Requires [Bun](https://bun.sh).

```bash
bun install
bun dev
```

No keys or env vars are needed. `.env.example` lists the optional ones (another Laya model host, a pinned Jev version).

## Layout

```
src/
  lib/detect/             rules for exact formats
  lib/jev/                the typed questions, the shared classify call, and the Jev server client
  lib/laya/               Laya in the browser: model worker, SDK bridge, TypeScript port of layaForWeb's core
  lib/tools/              pure helpers: JSON → TS, JWT, cron, color, stack parsing…
  app/api/classify/       POST { text } + the visitor's key → Jev's kind, language, cause
  hooks/use-detection.ts  rules first, then Laya or Jev
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

Laya by ConvAI Innovations and layaForWeb by Vishal Mysore, both Apache-2.0. See [NOTICE.md](NOTICE.md).
