import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Json, jsonStats, jsonToTs } from "@/lib/tools/json";
import { JsonTree } from "./json-tree";
import { CodeBlock } from "./shared";

export function JsonTool({ text }: { text: string }) {
  const value = JSON.parse(text) as Json;
  const { keys, depth } = jsonStats(value);
  const views = [
    ["formatted", "Formatted"],
    ["typescript", "TypeScript"],
    ["minified", "Minified"],
  ];

  return (
    <Tabs defaultValue="formatted" className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          {views.map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex gap-1.5">
          <Badge variant="secondary">{keys} keys</Badge>
          <Badge variant="secondary">depth {depth}</Badge>
        </div>
      </div>
      <TabsContent value="formatted">
        <JsonTree value={value} />
      </TabsContent>
      <TabsContent value="typescript">
        <CodeBlock code={jsonToTs(value)} />
      </TabsContent>
      <TabsContent value="minified">
        <CodeBlock code={JSON.stringify(value)} />
      </TabsContent>
    </Tabs>
  );
}
