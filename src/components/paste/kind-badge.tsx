import { AnimatePresence, motion } from "motion/react";
import { swap } from "@/lib/motion";
import type { Detection } from "@/lib/detect/types";
import { KIND_META } from "@/components/tools/registry";

const SOURCE_LABEL: Record<Detection["source"], string> = {
  rules: "exact match",
  laya: "read by Laya",
  jev: "read by Jev",
};

export function KindBadge({ detection }: { detection: Detection }) {
  const meta = KIND_META[detection.kind];
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={detection.kind}
        {...swap}
        className="flex items-center gap-3"
      >
        <div className="grid size-11 place-items-center rounded-xl bg-muted">
          <meta.icon className="size-5" />
        </div>
        <span className="font-medium">{meta.label}</span>
        <span className="text-sm text-muted-foreground">
          {SOURCE_LABEL[detection.source]}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}
