import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FramerToolError, withFramer } from "../framer-client.js";
import { ok, okMarkdown } from "../formatters.js";
import { nodeIdentity, serializeNode } from "../node-serialize.js";
import { NodeId, Pagination, paginate, ResponseFormat } from "../schemas.js";
import { walkDescendants } from "../walk.js";
import { registerTool } from "./register.js";

const readOnly = { readOnlyHint: true, idempotentHint: true };

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
    description:
      "Return the project's single canvas root node (parent of all pages). " +
      "NOTE: Framer has ONE canvas root for the whole project — it is not per-page. " +
      "To list the contents of a specific page, use framer_get_node_children on that page's id.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const root = await withFramer((f) => f.getCanvasRoot());
      return ok({ root: serializeNode(root) });
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
          ...nodeIdentity(p),
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
    description:
      "Fetch a node by id. Returns every attribute the SDK exposes — including layout, text, background, and component fields (componentIdentifier, url, controls, etc.).",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: readOnly,
    handler: async ({ nodeId }) => {
      const node = await withFramer((f) => f.getNode(nodeId));
      if (!node) {
        throw new FramerToolError(`Node ${nodeId} not found.`, undefined, "NODE_NOT_FOUND");
      }
      return ok({ node: serializeNode(node) });
    },
  });

  registerTool(server, {
    name: "framer_get_node_children",
    title: "Get node children",
    description:
      "List direct children of a node with their full attributes. " +
      "CAVEAT: For the primary breakpoint of a page (the Desktop frame), the Framer SDK sometimes returns no children even when the editor shows them — their descendants live on the secondary breakpoint frames (Tablet/Phone). If this tool returns an empty list for a frame you expect to be populated, try its sibling breakpoint frames.",
    inputSchema: z.object({ nodeId: NodeId, ...Pagination }),
    annotations: readOnly,
    handler: async ({ nodeId, limit, offset }) => {
      const children = await withFramer((f) => f.getChildren(nodeId));
      const mapped = children.map(serializeNode);
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
      return ok({ parent: parent ? serializeNode(parent) : null });
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
      "Return every node of the given class, optionally scoped to the subtree under `scopeNodeId`. " +
      "If scopeNodeId is set, only nodes that are descendants of that node (inclusive) are returned.",
    inputSchema: z.object({
      type: z.enum(FINDABLE_TYPES),
      scopeNodeId: NodeId.optional().describe(
        "Optional: restrict results to descendants of this node id (inclusive).",
      ),
      ...Pagination,
    }),
    annotations: readOnly,
    handler: async ({ type, scopeNodeId, limit, offset }) => {
      const result = await withFramer(async (f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = (await (f.getNodesWithType as any)(type)) as unknown[];
        if (!scopeNodeId) return { nodes: all, truncated: false };
        const scope = await walkDescendants(f, scopeNodeId);
        const filtered = all.filter((n) => {
          const id = (n as { id?: string }).id;
          return id && scope.ids.has(id);
        });
        return { nodes: filtered, truncated: scope.truncated };
      });
      const mapped = result.nodes.map(serializeNode);
      const page = paginate(mapped, limit, offset);
      return ok({
        ...(page as unknown as Record<string, unknown>),
        scope_truncated: result.truncated,
      });
    },
  });

  registerTool(server, {
    name: "framer_find_nodes_by_attribute",
    title: "Find nodes by attribute",
    description:
      "Find nodes that have a given attribute key. Optional filters: " +
      "`onlySet` to require the value is set, `value` to match a specific value exactly, " +
      "`scopeNodeId` to restrict to descendants of that node.",
    inputSchema: z.object({
      attribute: z.string().describe("Attribute key, e.g. 'name', 'backgroundColor', 'link'."),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .optional()
        .describe("Optional exact-match filter on the attribute's value."),
      onlySet: z.boolean().optional().describe("If true, include only nodes where the attribute is set."),
      scopeNodeId: NodeId.optional().describe("Optional: restrict results to descendants of this node id."),
      ...Pagination,
    }),
    annotations: readOnly,
    handler: async ({ attribute, value, onlySet, scopeNodeId, limit, offset }) => {
      const result = await withFramer(async (f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn: any = onlySet ? f.getNodesWithAttributeSet : f.getNodesWithAttribute;
        let nodes = (await fn.call(f, attribute)) as unknown[];

        if (scopeNodeId) {
          const scope = await walkDescendants(f, scopeNodeId);
          nodes = nodes.filter((n) => {
            const id = (n as { id?: string }).id;
            return id && scope.ids.has(id);
          });
        }

        if (value !== undefined) {
          nodes = nodes.filter((n) => {
            const v = (n as Record<string, unknown>)[attribute];
            return v === value;
          });
        }

        return nodes;
      });
      const mapped = result.map(serializeNode);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });

  registerTool(server, {
    name: "framer_find_nodes_by_name",
    title: "Find nodes by name",
    description:
      "Find nodes whose `name` attribute matches. Use `equals` for exact match or `contains` for substring match. Optionally scoped to `scopeNodeId`.",
    inputSchema: z
      .object({
        equals: z.string().optional(),
        contains: z.string().optional(),
        caseInsensitive: z.boolean().optional().describe("Default true."),
        scopeNodeId: NodeId.optional(),
        ...Pagination,
      })
      .refine((v) => !!v.equals || !!v.contains, {
        message: "Provide either `equals` or `contains`.",
      }),
    annotations: readOnly,
    handler: async ({ equals, contains, caseInsensitive, scopeNodeId, limit, offset }) => {
      const ci = caseInsensitive ?? true;
      const norm = (s: string) => (ci ? s.toLowerCase() : s);
      const matches = (name: string) => {
        if (equals !== undefined) return norm(name) === norm(equals);
        if (contains !== undefined) return norm(name).includes(norm(contains));
        return false;
      };

      const result = await withFramer(async (f) => {
        // `name` attribute is broadly supported, so getNodesWithAttribute gives
        // us the universe efficiently; scoping happens after.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = (await (f.getNodesWithAttribute as any)("name")) as unknown[];
        let nodes = all.filter((n) => {
          const nm = (n as { name?: string | null }).name;
          return typeof nm === "string" && matches(nm);
        });
        if (scopeNodeId) {
          const scope = await walkDescendants(f, scopeNodeId);
          nodes = nodes.filter((n) => {
            const id = (n as { id?: string }).id;
            return id && scope.ids.has(id);
          });
        }
        return nodes;
      });
      const mapped = result.map(serializeNode);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });
}
