import type { Detection } from "@/lib/detect/types";

const describe = (d: Detection) => (d.source === "rules" ? "0ms · rules" : `${d.latencyMs}ms · 3q · ${d.model}`);

type Props = { detection: Detection | null; pending: boolean; error: string | null };

export function LatencyHud({ detection, pending, error }: Props) {
  return (
    <p className="fixed right-4 bottom-4 font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {pending ? "reading…" : error ? error : detection ? describe(detection) : ""}
    </p>
  );
}
