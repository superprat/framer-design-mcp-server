import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FramerToolError, withFramer, withFramerWrite } from "../framer-client.js";
import { ok } from "../formatters.js";
import { registerTool } from "./register.js";

const readOnly = { readOnlyHint: true, idempotentHint: true };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

const stripCodeFile = (cf: unknown) => {
  const v = cf as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["id", "name", "createdAt", "updatedAt"]) if (k in v) out[k] = v[k];
  return out;
};

export function registerCodeTools(server: McpServer) {
  registerTool(server, {
    name: "framer_list_code_files",
    title: "List code files",
    description: "Return all code files in the project (name, id, timestamps).",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const files = await withFramer((f) => f.getCodeFiles());
      return ok({ codeFiles: files.map(stripCodeFile), count: files.length });
    },
  });

  registerTool(server, {
    name: "framer_get_code_file",
    title: "Get code file",
    description: "Read the full contents of a code file by id.",
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: readOnly,
    handler: async ({ id }) => {
      const file = await withFramer((f) => f.getCodeFile(id));
      if (!file) throw new FramerToolError(`Code file ${id} not found.`);
      const v = file as unknown as Record<string, unknown>;
      return ok({
        codeFile: {
          ...stripCodeFile(file),
          content: typeof v.content === "string" ? v.content : null,
        },
      });
    },
  });

  registerTool(server, {
    name: "framer_create_code_file",
    title: "Create code file",
    description:
      "Create a new code file. File name must include extension (e.g. 'Header.tsx'). Use .tsx for React/JSX.",
    inputSchema: z.object({
      name: z.string().min(1).describe("File name including extension, e.g. 'Hero.tsx'."),
      code: z.string().describe("File contents."),
    }),
    annotations: mutation,
    handler: async ({ name, code }) => {
      const file = await withFramerWrite((f) => f.createCodeFile(name, code));
      return ok({ codeFile: stripCodeFile(file) });
    },
  });

  registerTool(server, {
    name: "framer_typecheck_code",
    title: "Typecheck code",
    description:
      "Run the Framer TypeScript type checker against a file's proposed content. Returns diagnostics without saving.",
    inputSchema: z.object({
      fileName: z.string().min(1).describe("Must include extension; use .tsx for JSX."),
      content: z.string(),
    }),
    annotations: readOnly,
    handler: async ({ fileName, content }) => {
      const diagnostics = await withFramer((f) => f.typecheckCode(fileName, content));
      return ok({
        diagnostics: diagnostics as unknown as Record<string, unknown>[],
        count: diagnostics.length,
      });
    },
  });
}
