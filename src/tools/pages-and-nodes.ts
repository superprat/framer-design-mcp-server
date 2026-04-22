import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isTextNode } from "framer-api";
import { z } from "zod";
import { FramerToolError, withFramer } from "../framer-client.js";
import { ok } from "../formatters.js";
import { serializeNode } from "../node-serialize.js";
import { LooseAttributes, NodeId } from "../schemas.js";
import { registerTool } from "./register.js";

const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const idempotentMutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

export function registerPageAndNodeTools(server: McpServer) {
  // ------- Pages -------
  registerTool(server, {
    name: "framer_create_web_page",
    title: "Create web page",
    description:
      "Create a new WebPageNode at the given path (e.g. '/about'). Path should start with '/'. " +
      "NOTE: Framer may auto-insert a default Desktop breakpoint frame into the new page.",
    inputSchema: z.object({
      pagePath: z.string().min(1).describe("URL path, e.g. '/about'."),
    }),
    annotations: mutation,
    handler: async ({ pagePath }) => {
      const page = await withFramer((f) => f.createWebPage(pagePath));
      return ok({ page: serializeNode(page) }, `Created web page at ${pagePath}`);
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
      return ok({ page: serializeNode(page) }, `Created design page "${pageName}"`);
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
      return ok({ node: serializeNode(node) });
    },
  });

  registerTool(server, {
    name: "framer_create_text_node",
    title: "Create text node",
    description:
      "Create a new TextNode with the given attributes. If `text` is supplied it will be applied after creation via setText on the returned node.",
    inputSchema: z.object({
      attributes: LooseAttributes,
      parentId: NodeId.optional(),
      text: z.string().optional().describe("Optional plaintext content applied after creation."),
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
      return ok({ node: serializeNode(node) });
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
      return ok({ node: serializeNode(node) });
    },
  });

  registerTool(server, {
    name: "framer_add_component_instance",
    title: "Add component instance",
    description:
      "Insert an instance of a shared/remote component by its module URL, optionally into a parent node. " +
      "Use framer_get_node on an existing ComponentInstanceNode to read its `url` and re-insert elsewhere.",
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
      return ok({ node: serializeNode(node) });
    },
  });

  // ------- Node mutation -------
  registerTool(server, {
    name: "framer_set_node_attributes",
    title: "Set node attributes",
    description:
      "Update any editable attributes on a node (partial merge). Returns the updated node.",
    inputSchema: z.object({ nodeId: NodeId, attributes: LooseAttributes }),
    annotations: idempotentMutation,
    handler: async ({ nodeId, attributes }) => {
      const node = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.setAttributes(nodeId, attributes as any),
      );
      if (!node) {
        throw new FramerToolError(
          `Node ${nodeId} was not updated (may not exist).`,
          undefined,
          "NODE_NOT_FOUND",
        );
      }
      return ok({ node: serializeNode(node) });
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
        if (!node) {
          throw new FramerToolError(
            `Node ${nodeId} not found.`,
            undefined,
            "NODE_NOT_FOUND",
          );
        }
        if (!isTextNode(node)) {
          throw new FramerToolError(
            `Node ${nodeId} is not a TextNode (got ${(node as { __class: string }).__class}).`,
            "Use framer_set_node_attributes for non-text nodes, or framer_create_text_node to make a new one.",
            "WRONG_NODE_TYPE",
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
    description:
      "Duplicate a node and return the new node's id. " +
      "If `parentId` is provided, the clone is reparented there after creation (via setParent). " +
      "CAVEATS: " +
      "(1) The Framer SDK's cloneNode does not accept a destination — without `parentId`, the clone lands wherever Framer chooses (usually next to the source). " +
      "(2) Depth of the clone is determined by the SDK; complex nested hierarchies may be shallow-cloned. Inspect with framer_get_node_children after cloning. " +
      "(3) If `parentId` is set and the reparent fails, the orphan clone is automatically removed to preserve project state.",
    inputSchema: z.object({
      nodeId: NodeId,
      parentId: NodeId.optional().describe("Optional: reparent the clone under this node after creation."),
      index: z.number().int().min(0).optional().describe("Optional: insert position under parentId."),
    }),
    annotations: mutation,
    handler: async ({ nodeId, parentId, index }) => {
      const result = await withFramer(async (f) => {
        const clone = await f.cloneNode(nodeId);
        if (!clone) {
          throw new FramerToolError(
            `Node ${nodeId} could not be cloned.`,
            undefined,
            "CLONE_FAILED",
          );
        }
        const cloneId = (clone as { id?: string }).id;
        if (!parentId || !cloneId) return clone;

        try {
          await f.setParent(cloneId, parentId, index);
        } catch (reparentErr) {
          // Rollback: remove the orphan clone so we don't leave stray nodes
          // in an unintended location.
          try {
            await f.removeNodes([cloneId]);
          } catch {
            // best-effort rollback; surface the original error either way
          }
          const msg = reparentErr instanceof Error ? reparentErr.message : String(reparentErr);
          throw new FramerToolError(
            `Clone created ${cloneId} but reparenting under ${parentId} failed and the clone was removed: ${msg}`,
            "Verify parentId exists and accepts children of this type.",
            "CLONE_REPARENT_FAILED",
          );
        }
        // Re-read the clone so the returned attributes reflect the new parent.
        const reread = await f.getNode(cloneId);
        return reread ?? clone;
      });
      return ok({ node: serializeNode(result) });
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
      "Insert an SVG onto the canvas. The Framer SDK's addSVG does not accept a parentId — the SVG is placed at the current canvas context (typically the active page).",
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
