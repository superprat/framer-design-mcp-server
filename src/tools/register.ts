import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType, z } from "zod";
import { safeHandler, type ToolResult } from "../formatters.js";

export interface ToolDef<I extends ZodType, O extends ZodType | undefined = undefined> {
  name: string;
  title?: string;
  description: string;
  inputSchema: I;
  outputSchema?: O;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (input: z.infer<I>) => Promise<ToolResult>;
}

export function registerTool<I extends ZodType, O extends ZodType | undefined = undefined>(
  server: McpServer,
  def: ToolDef<I, O>,
) {
  const config: Record<string, unknown> = {
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: {
      openWorldHint: true,
      ...def.annotations,
    },
  };
  if (def.title) config.title = def.title;
  if (def.outputSchema) config.outputSchema = def.outputSchema;

  // The SDK's registerTool overloads are typed around ZodRawShape or AnySchema; z.object satisfies AnySchema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(def.name, config, safeHandler(def.handler));
}
