import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withFramer } from "../framer-client.js";
import { ok, okMarkdown } from "../formatters.js";
import { NodeId, Pagination, paginate, ResponseFormat } from "../schemas.js";
import { registerTool } from "./register.js";

const nodeSummary = (n: unknown) => {
  // Node instances carry arbitrary methods; extract a stable subset for transport.
  const node = n as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["__class", "id", "name", "path", "locked", "visible"]) {
    if (k in node) out[k] = node[k];
  }
  return out;
};

const readOnly = { readOnlyHint: true, idempotentHint: true };

const PAGE_TYPES = ["WebPageNode", "DesignPageNode"] as const;
const FINDABLE_TYPES = [
  "FrameNode",
  "TextNode",
  "SVGNode",
  "ComponentInstanceNode",
  "ComponentNode",
  "WebPageNode",
  "DesignPageNode",
] as const;

export function registerInspectionTools(server: McpServer) {
  registerTool(server, {
    name: "framer_get_project_info",
    title: "Get Framer project info",
    description: "Return metadata about the connected Framer project (name, id, etc.).",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const info = await withFramer((f) => f.getProjectInfo());
      return ok({ projectInfo: info as unknown as Record<string, unknown> });
    },
  });

  registerTool(server, {
    name: "framer_get_current_user",
    title: "Get current Framer user",
    description: "Return the user identity associated with the API key.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const user = await withFramer((f) => f.getCurrentUser());
      return ok({ user: user as unknown as Record<string, unknown> });
    },
  });

  registerTool(server, {
    name: "framer_get_canvas_root",
    title: "Get canvas root",
    description: "Return the project's canvas root node (parent of all pages).",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const root = await withFramer((f) => f.getCanvasRoot());
      return ok({ root: nodeSummary(root) });
    },
  });

  registerTool(server, {
    name: "framer_list_pages",
    title: "List pages",
    description:
      "List every WebPageNode and DesignPageNode in the project. Useful for discovering pages to edit by id.",
    inputSchema: z.object({
      response_format: ResponseFormat,
      ...Pagination,
    }),
    annotations: readOnly,
    handler: async ({ response_format, limit, offset }) => {
      const pages = await withFramer(async (f) => {
        const [web, design] = await Promise.all([
          f.getNodesWithType("WebPageNode"),
          f.getNodesWithType("DesignPageNode"),
        ]);
        return [...web, ...design].map((p) => ({
          kind: (p as { __class: string }).__class,
          ...nodeSummary(p),
        }));
      });
      const page = paginate(pages, limit, offset);

      if (response_format === "markdown") {
        const lines = page.items.map((p) => {
          const v = p as { kind: string; id?: string; name?: string; path?: string };
          return `- **${v.kind}** \`${v.id ?? ""}\`  ${v.name ?? ""}  ${v.path ?? ""}`;
        });
        return okMarkdown(
          [`## Pages (${page.count}/${page.total})`, ...lines].join("\n"),
          page as unknown as Record<string, unknown>,
        );
      }
      return ok(page as unknown as Record<string, unknown>);
    },
  });

  registerTool(server, {
    name: "framer_get_node",
    title: "Get node",
    description: "Fetch a node by id. Returns class, name, and common attributes.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: readOnly,
    handler: async ({ nodeId }) => {
      const node = await withFramer((f) => f.getNode(nodeId));
      if (!node) return ok({ node: null });
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_get_node_children",
    title: "Get node children",
    description: "List direct children of a node.",
    inputSchema: z.object({ nodeId: NodeId, ...Pagination }),
    annotations: readOnly,
    handler: async ({ nodeId, limit, offset }) => {
      const children = await withFramer((f) => f.getChildren(nodeId));
      const mapped = children.map(nodeSummary);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });

  registerTool(server, {
    name: "framer_get_node_parent",
    title: "Get node parent",
    description: "Return the parent of a node, or null if it is the canvas root.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: readOnly,
    handler: async ({ nodeId }) => {
      const parent = await withFramer((f) => f.getParent(nodeId));
      return ok({ parent: parent ? nodeSummary(parent) : null });
    },
  });

  registerTool(server, {
    name: "framer_get_node_rect",
    title: "Get node rect",
    description: "Return the bounding rect (x/y/width/height) of a node in canvas coordinates.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: readOnly,
    handler: async ({ nodeId }) => {
      const rect = await withFramer((f) => f.getRect(nodeId));
      return ok({ rect: rect as Record<string, unknown> | null });
    },
  });

  registerTool(server, {
    name: "framer_find_nodes_by_type",
    title: "Find nodes by type",
    description:
      "Return every node of the given class in the project (e.g. 'FrameNode', 'TextNode'). Paginated.",
    inputSchema: z.object({
      type: z.enum(FINDABLE_TYPES),
      ...Pagination,
    }),
    annotations: readOnly,
    handler: async ({ type, limit, offset }) => {
      const nodes = await withFramer(async (f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await (f.getNodesWithType as any)(type)) as unknown[];
      });
      const mapped = nodes.map(nodeSummary);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });

  registerTool(server, {
    name: "framer_find_nodes_by_attribute",
    title: "Find nodes by attribute",
    description:
      "Return nodes that support a given attribute key. If onlySet=true, only nodes whose value is set are returned.",
    inputSchema: z.object({
      attribute: z.string().describe("Attribute key, e.g. 'name', 'backgroundColor', 'link'."),
      onlySet: z.boolean().optional().describe("If true, filter to nodes where the attribute value is set."),
      ...Pagination,
    }),
    annotations: readOnly,
    handler: async ({ attribute, onlySet, limit, offset }) => {
      const nodes = await withFramer(async (f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn: any = onlySet ? f.getNodesWithAttributeSet : f.getNodesWithAttribute;
        return (await fn.call(f, attribute)) as unknown[];
      });
      const mapped = nodes.map(nodeSummary);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });

  // Mark the unused PAGE_TYPES as intentionally exported (documentation-only).
  void PAGE_TYPES;
}
