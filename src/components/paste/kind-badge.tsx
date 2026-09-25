import { AnimatePresence, motion } from "motion/react";
import { swap } from "@/lib/motion";
import type { Detection } from "@/lib/detect/types";
import { KIND_META } from "@/components/tools/registry";

const SOURCE_LABEL: Record<Detection["source"], string> = {
  rules: "exact match",
  laya: "read by Laya",
  jev: "read by Jev",
};

// Below this the model is close to guessing between stack trace, code and prose (a third each is a coin toss).
const UNSURE = 0.6;

export function KindBadge({ detection }: { detection: Detection }) {
  const meta = KIND_META[detection.kind];
  const guess = detection.source !== "rules";
  const unsure = guess && detection.sure < UNSURE;
  return (
    <div className="grid gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={detection.kind} {...swap} className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-muted">
            <meta.icon className="size-5" />
          </div>
          <span className="font-medium">{meta.label}</span>
          <span className="text-sm text-muted-foreground">
            {SOURCE_LABEL[detection.source]}
            {guess && ` · ${Math.round(detection.sure * 100)}% sure`}
          </span>
        </motion.div>
      </AnimatePresence>
      {guess && (
        // A model's reading is a guess, unlike the exact-format rules: say so, louder when it isn't sure.
        <p
          role="note"
          className={
            unsure
              ? "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
              : "text-xs text-muted-foreground"
          }
        >
          {unsure
            ? "The model isn't sure about this one. It may be wrong, so check the kind, language and cause below."
            : "Read by a model, so it may be wrong. Check the kind, language and cause below."}
        </p>
      )}
    </div>
  );
}
