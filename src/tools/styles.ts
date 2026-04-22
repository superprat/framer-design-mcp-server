import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withFramer } from "../framer-client.js";
import { ok } from "../formatters.js";
import { registerTool } from "./register.js";

const readOnly = { readOnlyHint: true, idempotentHint: true };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

const stripStyle = (s: unknown) => {
  const v = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["id", "name", "path", "light", "dark"]) if (k in v) out[k] = v[k];
  return out;
};

export function registerStyleTools(server: McpServer) {
  registerTool(server, {
    name: "framer_list_color_styles",
    title: "List color styles",
    description: "Return all color styles defined in the project.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const styles = await withFramer((f) => f.getColorStyles());
      return ok({ colorStyles: styles.map(stripStyle), count: styles.length });
    },
  });

  registerTool(server, {
    name: "framer_create_color_style",
    title: "Create color style",
    description:
      "Create a new color style. `light` is required (CSS color string). `dark` may be provided for dark mode.",
    inputSchema: z.object({
      light: z.string().describe("CSS color string for light mode, e.g. '#1a1a1a' or 'rgb(10,10,10)'."),
      dark: z.string().nullable().optional(),
      name: z.string().optional(),
      path: z.string().optional().describe("Hierarchical folder path, e.g. 'ui/text/primary'."),
    }),
    annotations: mutation,
    handler: async (attrs) => {
      const style = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.createColorStyle(attrs as any),
      );
      return ok({ style: stripStyle(style) });
    },
  });

  registerTool(server, {
    name: "framer_list_text_styles",
    title: "List text styles",
    description: "Return all text styles defined in the project.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const styles = await withFramer((f) => f.getTextStyles());
      const mapped = styles.map((s) => {
        const v = s as unknown as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of ["id", "name", "path", "fontSize", "fontWeight", "lineHeight", "letterSpacing"])
          if (k in v) out[k] = v[k];
        return out;
      });
      return ok({ textStyles: mapped, count: styles.length });
    },
  });

  registerTool(server, {
    name: "framer_create_text_style",
    title: "Create text style",
    description:
      "Create a new text style. Attributes follow the Framer Plugin API TextStyleAttributes shape (name, path, fontSize, fontWeight, lineHeight, color, etc.).",
    inputSchema: z.object({
      attributes: z
        .record(z.string(), z.unknown())
        .describe("Partial TextStyleAttributes. See Framer Plugin API docs for the full shape."),
    }),
    annotations: mutation,
    handler: async ({ attributes }) => {
      const style = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.createTextStyle(attributes as any),
      );
      const v = style as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of ["id", "name", "path"]) if (k in v) out[k] = v[k];
      return ok({ style: out });
    },
  });

  registerTool(server, {
    name: "framer_list_fonts",
    title: "List fonts",
    description: "Return all available fonts. Use the `family` value as a `fontFamily` attribute.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const fonts = await withFramer((f) => f.getFonts());
      const mapped = fonts.map((font) => {
        const v = font as unknown as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of ["family", "weight", "style", "source"]) if (k in v) out[k] = v[k];
        return out;
      });
      return ok({ fonts: mapped, count: fonts.length });
    },
  });
}
