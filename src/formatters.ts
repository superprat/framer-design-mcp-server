import type { FramerToolError } from "./framer-client.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: Array<TextContent | ImageContent>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function ok(structured: Record<string, unknown>, text?: string): ToolResult {
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

export function okMarkdown(markdown: string, structured?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text: markdown }] };
  if (structured) result.structuredContent = structured;
  return result;
}

export function okImage(data: Buffer, mimeType: string, summary: string): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "image", data: data.toString("base64"), mimeType },
    ],
  };
}

export function toolError(err: unknown): ToolResult {
  const e = err as Partial<FramerToolError> & Error;
  const header = e.code ? `Framer error [${e.code}]: ${e.message ?? String(err)}` : `Error: ${e.message ?? String(err)}`;
  const parts = [header];
  if (e.hint) parts.push(`Hint: ${e.hint}`);
  return {
    isError: true,
    content: [{ type: "text", text: parts.join("\n") }],
  };
}

/**
 * Wraps a tool handler so any thrown error becomes a structured MCP tool error
 * rather than a protocol-level failure. Tool errors let the LLM see and react.
 */
export function safeHandler<Args, R extends ToolResult>(
  fn: (args: Args) => Promise<R>,
): (args: Args) => Promise<R | ToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      return toolError(err);
    }
  };
}
