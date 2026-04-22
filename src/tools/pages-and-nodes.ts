import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isTextNode } from "framer-api";
import { z } from "zod";
import { withFramer, FramerToolError } from "../framer-client.js";
import { ok } from "../formatters.js";
import { NodeId, LooseAttributes } from "../schemas.js";
import { registerTool } from "./register.js";

const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const idempotentMutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const nodeSummary = (n: unknown) => {
  const node = n as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["__class", "id", "name", "path"]) if (k in node) out[k] = node[k];
  return out;
};

export function registerPageAndNodeTools(server: McpServer) {
  // ------- Pages -------
  registerTool(server, {
    name: "framer_create_web_page",
    title: "Create web page",
    description:
      "Create a new WebPageNode at the given path (e.g. '/about'). Path should start with '/'.",
    inputSchema: z.object({
      pagePath: z.string().min(1).describe("URL path, e.g. '/about'."),
    }),
    annotations: mutation,
    handler: async ({ pagePath }) => {
      const page = await withFramer((f) => f.createWebPage(pagePath));
      return ok({ page: nodeSummary(page) }, `Created web page at ${pagePath}`);
    },
  });

  registerTool(server, {
    name: "framer_create_design_page",
    title: "Create design page",
    description: "Create a new DesignPageNode with the given display name.",
    inputSchema: z.object({ pageName: z.string().min(1) }),
    annotations: mutation,
    handler: async ({ pageName }) => {
      const page = await withFramer((f) => f.createDesignPage(pageName));
      return ok({ page: nodeSummary(page) }, `Created design page "${pageName}"`);
    },
  });

  // ------- Node creation -------
  registerTool(server, {
    name: "framer_create_frame",
    title: "Create frame node",
    description:
      "Create a new FrameNode with the given attributes, optionally as a child of parentId. Attributes may include width, height, backgroundColor, name, etc.",
    inputSchema: z.object({
      attributes: LooseAttributes,
      parentId: NodeId.optional(),
    }),
    annotations: mutation,
    handler: async ({ attributes, parentId }) => {
      const node = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.createFrameNode(attributes as any, parentId),
      );
      if (!node) throw new FramerToolError("Framer did not return a created frame node.");
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_create_text_node",
    title: "Create text node",
    description:
      "Create a new TextNode with the given attributes. To set the text content, follow with framer_set_text using the returned id.",
    inputSchema: z.object({
      attributes: LooseAttributes,
      parentId: NodeId.optional(),
      text: z
        .string()
        .optional()
        .describe("Optional plaintext content. If provided, will be applied after creation."),
    }),
    annotations: mutation,
    handler: async ({ attributes, parentId, text }) => {
      const node = await withFramer(async (f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const n = await f.createTextNode(attributes as any, parentId);
        if (n && text !== undefined) await n.setText(text);
        return n;
      });
      if (!node) throw new FramerToolError("Framer did not return a created text node.");
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_create_component_node",
    title: "Create local component",
    description: "Create a new reusable ComponentNode (local component) with the given name.",
    inputSchema: z.object({ name: z.string().min(1) }),
    annotations: mutation,
    handler: async ({ name }) => {
      const node = await withFramer((f) => f.createComponentNode(name));
      if (!node) throw new FramerToolError("Framer did not return a created component node.");
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_add_component_instance",
    title: "Add component instance",
    description:
      "Insert an instance of a shared/remote component, identified by its module URL, optionally into a parent node.",
    inputSchema: z.object({
      url: z.string().url(),
      attributes: LooseAttributes.optional(),
      parentId: NodeId.optional(),
    }),
    annotations: mutation,
    handler: async ({ url, attributes, parentId }) => {
      const node = await withFramer((f) =>
        f.addComponentInstance({
          url,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          attributes: (attributes ?? {}) as any,
          parentId,
        }),
      );
      return ok({ node: nodeSummary(node) });
    },
  });

  // ------- Node mutation -------
  registerTool(server, {
    name: "framer_set_node_attributes",
    title: "Set node attributes",
    description:
      "Update any editable attributes on a node (partial merge). Returns the updated node summary.",
    inputSchema: z.object({ nodeId: NodeId, attributes: LooseAttributes }),
    annotations: idempotentMutation,
    handler: async ({ nodeId, attributes }) => {
      const node = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.setAttributes(nodeId, attributes as any),
      );
      if (!node) throw new FramerToolError(`Node ${nodeId} was not updated (may not exist).`);
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_set_text",
    title: "Set text node content",
    description: "Set the plaintext content of a TextNode.",
    inputSchema: z.object({ nodeId: NodeId, text: z.string() }),
    annotations: idempotentMutation,
    handler: async ({ nodeId, text }) => {
      await withFramer(async (f) => {
        const node = await f.getNode(nodeId);
        if (!node) throw new FramerToolError(`Node ${nodeId} not found.`);
        if (!isTextNode(node)) {
          throw new FramerToolError(
            `Node ${nodeId} is not a TextNode (got ${(node as { __class: string }).__class}).`,
            "Use framer_set_node_attributes for non-text nodes, or framer_create_text_node to make a new one.",
          );
        }
        await node.setText(text);
      });
      return ok({ nodeId, text });
    },
  });

  registerTool(server, {
    name: "framer_set_parent",
    title: "Reparent node",
    description:
      "Move a node under a new parent, optionally inserting at a specific child index (0-based).",
    inputSchema: z.object({
      nodeId: NodeId,
      parentId: NodeId,
      index: z.number().int().min(0).optional(),
    }),
    annotations: idempotentMutation,
    handler: async ({ nodeId, parentId, index }) => {
      await withFramer((f) => f.setParent(nodeId, parentId, index));
      return ok({ nodeId, parentId, index: index ?? null });
    },
  });

  registerTool(server, {
    name: "framer_clone_node",
    title: "Clone node",
    description: "Duplicate a node and return the new node's id.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: mutation,
    handler: async ({ nodeId }) => {
      const node = await withFramer((f) => f.cloneNode(nodeId));
      if (!node) throw new FramerToolError(`Node ${nodeId} could not be cloned.`);
      return ok({ node: nodeSummary(node) });
    },
  });

  registerTool(server, {
    name: "framer_remove_node",
    title: "Remove node",
    description: "Delete a node from the canvas. Destructive.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: destructive,
    handler: async ({ nodeId }) => {
      await withFramer((f) => f.removeNodes([nodeId]));
      return ok({ removed: nodeId });
    },
  });

  registerTool(server, {
    name: "framer_add_svg",
    title: "Add SVG",
    description:
      "Insert an SVG onto the canvas. Accepts an object with svg source, and optional name/parentId.",
    inputSchema: z.object({
      svg: z.string().describe("Raw SVG source."),
      name: z.string().optional(),
    }),
    annotations: mutation,
    handler: async ({ svg, name }) => {
      await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.addSVG({ svg, name } as any),
      );
      return ok({ added: true, name: name ?? null });
    },
  });
}
