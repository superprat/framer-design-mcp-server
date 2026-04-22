import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withFramer } from "../framer-client.js";
import { ok, okImage } from "../formatters.js";
import { NodeId } from "../schemas.js";
import { registerTool } from "./register.js";

const readOnly = { readOnlyHint: true, idempotentHint: true };

export function registerVisualTools(server: McpServer) {
  registerTool(server, {
    name: "framer_screenshot_node",
    title: "Screenshot node",
    description:
      "Render a node to a PNG/JPEG image and return it as inline image content. Use this after design edits to visually verify the result. " +
      "LIMITATIONS: " +
      "(1) Framer enforces a server-side timeout. Full-page or breakpoint-sized frames at default scale frequently time out — when they do you'll receive error code TIMEOUT. " +
      "(2) For large nodes, reduce `scale` (try 0.5), pass a `clip` region, or screenshot child sections individually. " +
      "(3) SCREENSHOT_TOO_LARGE is raised separately when the output exceeds Framer's size cap — same fix (lower scale or clip).",
    inputSchema: z.object({
      nodeId: NodeId,
      format: z.enum(["png", "jpeg"]).optional(),
      quality: z.number().int().min(1).max(100).optional().describe("JPEG quality (1-100)."),
      scale: z
        .union([z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2), z.literal(3), z.literal(4)])
        .optional()
        .describe("Pixel density multiplier. Default 1."),
      clip: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional()
        .describe("Optional clip region in CSS pixels before scaling."),
    }),
    annotations: readOnly,
    handler: async ({ nodeId, format, quality, scale, clip }) => {
      const result = await withFramer((f) =>
        f.screenshot(nodeId, {
          ...(format ? { format } : {}),
          ...(quality !== undefined ? { quality } : {}),
          ...(scale !== undefined ? { scale } : {}),
          ...(clip ? { clip } : {}),
        }),
      );
      const bytes = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
      return okImage(bytes, result.mimeType, `Screenshot of node ${nodeId}`);
    },
  });

  registerTool(server, {
    name: "framer_export_svg",
    title: "Export node as SVG",
    description: "Export a node as SVG source (string). Useful for vector/icon nodes.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: readOnly,
    handler: async ({ nodeId }) => {
      const svg = await withFramer((f) => f.exportSVG(nodeId));
      return ok({ svg, nodeId });
    },
  });
}
