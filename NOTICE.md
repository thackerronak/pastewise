# Notices

pastewise includes code derived from the following projects, licensed under the Apache License, Version 2.0. The
license text is in [`licenses/APACHE-2.0.txt`](licenses/APACHE-2.0.txt).

## layaForWeb

- Source: https://github.com/vishalmysore/layaForWeb
- Copyright 2026 vishalmysore

Used here:

- `src/lib/laya/core.ts` is a TypeScript port of layaForWeb's `web/laya-core.js`.
- `src/lib/laya/fixtures/seq_tests.json` is copied unchanged from layaForWeb's `tests/seq_tests.json`.

**Changes made in pastewise** (Apache-2.0 section 4b): `laya-core.js` was ported to TypeScript, and the model name it
reports is passed in by the caller instead of being fixed.

layaForWeb's own notice, carried over as section 4(d) requires:

> layaForWeb is an unofficial browser port of the English Laya checkpoint. It is not affiliated with or endorsed by
> ConvAI Innovations, Microsoft, Hugging Face, Answer.AI or LightOn.
>
> **Laya (model weights, tokenizer, reference code).** Source: https://huggingface.co/convaiinnovations/laya and
> https://github.com/NandhaKishorM/laya (PyPI: `laya`). Copyright: ConvAI Innovations. License: Apache License,
> Version 2.0.
>
> Changes made in that project: the English checkpoint was exported to ONNX; the weights were quantized (weight-only
> int8 or int4, int8 embeddings) and split into 24 MiB parts; `web/laya-core.js` is a JavaScript port of the Python
> `laya/common.py` (`build_sequence`) and `laya/agent.py` (`system_one`) inference code. The quantized files are
> modified derivatives of Laya and are not the original release. Their outputs differ slightly from the original.
>
> **ModernBERT.** The encoder architecture and initial weights of Laya come from ModernBERT-large by Answer.AI and
> LightOn, released under the Apache License, Version 2.0. https://huggingface.co/answerdotai/ModernBERT-large

## Model files

The model loaded at runtime is layaForWeb's ONNX build of `convaiinnovations/laya-typed-decisions` (Apache-2.0),
hosted at https://huggingface.co/VishalMysore/layaForWebTrained. The visitor's browser downloads it from there. It is
not part of this repository.

pastewise is not affiliated with or endorsed by ConvAI Innovations, Answer.AI, LightOn or the author of layaForWeb.

## npm dependencies

ONNX Runtime Web (`onnxruntime-web`, MIT, Microsoft) and Tokenizers.js (`@huggingface/tokenizers`, Apache-2.0,
Hugging Face) are installed from npm and ship with their own license files.
