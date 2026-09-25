"use client";

import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Json } from "@/lib/tools/json";
import { cn } from "@/lib/utils";
import { CopyButton } from "./shared";

// Nodes deeper than this start collapsed, so a large document opens as an outline.
const OPEN_DEPTH = 3;

const COLORS = {
  key: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  boolean: "text-violet-700 dark:text-violet-300",
  null: "text-rose-600 italic dark:text-rose-300",
  punct: "text-muted-foreground",
};

type Container = Json[] | { [key: string]: Json };
const isContainer = (v: Json): v is Container => v !== null && typeof v === "object";
const entries = (v: Container): [string, Json][] => (Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v));

/** Paths ("$", "$.user", "$.user.roles") of every object and array, with their depth. */
function containers(value: Json, path = "$", depth = 0, out: [string, number][] = []) {
  if (!isContainer(value)) return out;
  out.push([path, depth]);
  for (const [k, v] of entries(value)) containers(v, `${path}.${k}`, depth + 1, out);
  return out;
}

function Primitive({ value }: { value: Exclude<Json, Container> }) {
  if (value === null) return <span className={COLORS.null}>null</span>;
  if (typeof value === "string") return <span className={cn(COLORS.string, "break-all")}>{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className={COLORS.number}>{String(value)}</span>;
  return <span className={COLORS.boolean}>{String(value)}</span>;
}

type NodeProps = {
  name: string | null;
  value: Json;
  path: string;
  last: boolean;
  collapsed: Set<string>;
  toggle: (path: string) => void;
};

function Node({ name, value, path, last, collapsed, toggle }: NodeProps) {
  const comma = last ? null : <span className={COLORS.punct}>,</span>;
  const label = name !== null && (
    <>
      <span className={COLORS.key}>{JSON.stringify(name)}</span>
      <span className={COLORS.punct}>: </span>
    </>
  );

  if (!isContainer(value)) {
    return (
      <div className="pl-5">
        {label}
        <Primitive value={value} />
        {comma}
      </div>
    );
  }

  const list = entries(value);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  const isClosed = collapsed.has(path);
  const count = Array.isArray(value) ? `${list.length} ${list.length === 1 ? "item" : "items"}` : `${list.length} ${list.length === 1 ? "key" : "keys"}`;

  if (!list.length) {
    return (
      <div className="pl-5">
        {label}
        <span className={COLORS.punct}>
          {open}
          {close}
        </span>
        {comma}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(path)}
        aria-expanded={!isClosed}
        aria-label={`${isClosed ? "Expand" : "Collapse"} ${name ?? "root"}`}
        className="group/node flex w-full items-start rounded text-left hover:bg-foreground/5"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150", !isClosed && "rotate-90")}
        />
        <span className="pl-1">
          {label}
          <span className={COLORS.punct}>{open}</span>
          {isClosed && (
            <>
              <span className="mx-1 rounded bg-muted px-1 text-muted-foreground">{count}</span>
              <span className={COLORS.punct}>{close}</span>
              {comma}
            </>
          )}
        </span>
      </button>
      {!isClosed && (
        <>
          <div className="ml-2 border-l border-border pl-2">
            {list.map(([k, v], i) => (
              <Node
                key={k}
                name={Array.isArray(value) ? null : k}
                value={v}
                path={`${path}.${k}`}
                last={i === list.length - 1}
                collapsed={collapsed}
                toggle={toggle}
              />
            ))}
          </div>
          <div className="pl-5">
            <span className={COLORS.punct}>{close}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

/** A colour-coded JSON outline: click any object or array to fold it, or expand and collapse everything at once. */
export function JsonTree({ value }: { value: Json }) {
  const all = useMemo(() => containers(value), [value]);
  const [collapsed, setCollapsed] = useState(() => new Set(all.filter(([, d]) => d >= OPEN_DEPTH).map(([p]) => p)));
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const pretty = useMemo(() => JSON.stringify(value, null, 2), [value]);

  return (
    <div className="relative rounded-lg bg-muted/60">
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {all.length > 1 && (
          <>
            <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set(all.filter(([, d]) => d > 0).map(([p]) => p)))}>
              Collapse all
            </Button>
          </>
        )}
        <CopyButton value={pretty} />
      </div>
      <div className="max-h-96 overflow-auto p-4 pt-10 font-mono text-xs leading-relaxed">
        {isContainer(value) ? (
          <Node name={null} value={value} path="$" last collapsed={collapsed} toggle={toggle} />
        ) : (
          <Primitive value={value} />
        )}
      </div>
    </div>
  );
}
