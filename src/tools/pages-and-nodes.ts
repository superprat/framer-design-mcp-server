import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isTextNode } from "framer-api";
import { z } from "zod";
import { FramerToolError, withFramer } from "../framer-client.js";
import { ok } from "../formatters.js";
import { serializeNode } from "../node-serialize.js";
import { LooseAttributes, NodeId } from "../schemas.js";
import { assertParent, assertRemoved, bestEffortRemove } from "../verify.js";
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
      "LIMITATIONS: " +
      "(1) Framer auto-inserts a default primary breakpoint frame (the Desktop frame, ~1200x1080, no layout) as a child of the new page — you cannot skip or remove it (see framer_remove_node). " +
      "(2) To customize the primary breakpoint dimensions/layout, call framer_set_node_attributes on it after creation.",
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
      "Create a new FrameNode with the given attributes, optionally as a child of parentId. " +
      "ATTRIBUTE VALUE FORMAT: dimensions must be CSS-unit strings, not bare numbers. " +
      "Use `width: '1440px'` not `width: 1440` — bare numbers are silently coerced to 100. " +
      "Same for `height`, `borderRadius`, `padding`, `gap`, etc. Colors should be hex or rgb() strings. " +
      "LIMITATION: some attributes (e.g. `position: 'sticky'`, certain nested layout controls) may be rejected or coerced at creation time and require a follow-up framer_set_node_attributes call to take effect.",
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
      "Use framer_get_node on an existing ComponentInstanceNode to read its `url` and re-insert elsewhere. " +
      "LIMITATIONS: " +
      "(1) Passing `attributes` at creation sometimes triggers a 'Moving nodes is not allowed in view only mode' error from Framer — retry without attributes and apply them afterwards with framer_set_node_attributes. " +
      "(2) Framer may place the new instance in the page's primary breakpoint auto-frame regardless of `parentId`. This tool verifies landing and attempts a corrective framer_set_parent if the instance ends up in the wrong place — if that also fails, an error is returned so you don't silently leave nodes in the wrong location.",
    inputSchema: z.object({
      url: z.string().url(),
      attributes: LooseAttributes.optional(),
      parentId: NodeId.optional(),
    }),
    annotations: mutation,
    handler: async ({ url, attributes, parentId }) => {
      const node = await withFramer(async (f) => {
        const instance = await f.addComponentInstance({
          url,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          attributes: (attributes ?? {}) as any,
          parentId,
        });
        const instanceId = (instance as { id?: string }).id;
        if (parentId && instanceId) {
          const currentParent = await f.getParent(instanceId).catch(() => null);
          const currentParentId = currentParent ? (currentParent as { id?: string }).id : null;
          if (currentParentId !== parentId) {
            // Framer landed it somewhere else. Try a corrective setParent.
            try {
              await f.setParent(instanceId, parentId);
              await assertParent(f, instanceId, parentId, "add_component_instance (after corrective setParent)");
            } catch (e) {
              // Leave the node in place so the caller can inspect, but raise.
              const msg = e instanceof Error ? e.message : String(e);
              throw new FramerToolError(
                `Component instance ${instanceId} was created but landed under ${currentParentId ?? "null"}, and the corrective move to ${parentId} failed: ${msg}`,
                "Verify parentId exists on the same page, then try framer_set_parent manually.",
                "WRONG_PARENT",
              );
            }
          }
        }
        return instance;
      });
      return ok({ node: serializeNode(node) });
    },
  });

  // ------- Node mutation -------
  registerTool(server, {
    name: "framer_set_node_attributes",
    title: "Set node attributes",
    description:
      "Update any editable attributes on a node (partial merge). Returns the updated node. " +
      "ATTRIBUTE VALUE FORMAT: dimensions must be CSS-unit strings ('1440px', not 1440). " +
      "Colors are hex or rgb(...) strings. This tool is the RECOMMENDED way to apply attributes that failed to persist during framer_create_frame / framer_add_component_instance (which often silently coerce or reject values at creation time).",
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
    description:
      "Set the plaintext content of a TextNode. " +
      "LIMITATION: only works on TextNode instances — for other node types, use framer_set_node_attributes. " +
      "Raises WRONG_NODE_TYPE with the actual class if you pass a non-TextNode id.",
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
      "Move a node under a new parent, optionally inserting at a specific child index (0-based). " +
      "Verifies the move succeeded and raises WRONG_PARENT if Framer silently no-op'd it (can happen for cross-page moves or when the target parent does not accept this node type).",
    inputSchema: z.object({
      nodeId: NodeId,
      parentId: NodeId,
      index: z.number().int().min(0).optional(),
    }),
    annotations: idempotentMutation,
    handler: async ({ nodeId, parentId, index }) => {
      await withFramer(async (f) => {
        await f.setParent(nodeId, parentId, index);
        await assertParent(f, nodeId, parentId, "set_parent");
      });
      return ok({ nodeId, parentId, index: index ?? null });
    },
  });

  registerTool(server, {
    name: "framer_clone_node",
    title: "Clone node",
    description:
      "Duplicate a node and return the new node's id. " +
      "If `parentId` is provided, the clone is reparented there after creation (via setParent) AND the parent is verified post-move. " +
      "LIMITATIONS: " +
      "(1) The Framer SDK's cloneNode does not accept a destination. Without `parentId`, the clone lands wherever Framer chooses — usually next to the source, NOT on the page you expect. " +
      "(2) Framer's setParent can silently no-op for cross-page moves. This tool now verifies `getParent(clone) === parentId` after the move and raises WRONG_PARENT if Framer rejected the move. " +
      "(3) Clone depth is determined by the SDK. Complex nested hierarchies (especially top-level breakpoint frames like the Desktop frame of a page) are often SHALLOW-cloned — the returned node may be the correct size but contain no children. Inspect with framer_get_node_children or framer_list_descendants after cloning. " +
      "(4) If the reparent or verification fails, the orphan clone is automatically removed so the project is not left in an unintended state.",
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
          // Verify — Framer's setParent can silently no-op for cross-page moves.
          await assertParent(f, cloneId, parentId, "clone_node");
        } catch (reparentErr) {
          // Rollback: remove the orphan clone so we don't leave a stray node
          // on the wrong page.
          await bestEffortRemove(f, cloneId);
          if (reparentErr instanceof FramerToolError) throw reparentErr;
          const msg = reparentErr instanceof Error ? reparentErr.message : String(reparentErr);
          throw new FramerToolError(
            `Clone created ${cloneId} but reparenting under ${parentId} failed and the clone was removed: ${msg}`,
            "Verify parentId exists on a page that can accept this node type.",
            "CLONE_REPARENT_FAILED",
          );
        }
        const reread = await f.getNode(cloneId);
        return reread ?? clone;
      });
      return ok({ node: serializeNode(result) });
    },
  });

  registerTool(server, {
    name: "framer_remove_node",
    title: "Remove node",
    description:
      "Delete a node from the canvas. Destructive. " +
      "This tool verifies removal — if Framer silently re-instantiates the node (happens for the primary breakpoint frame Framer requires on every page), it raises NODE_REINSTATIATED instead of falsely reporting success. " +
      "LIMITATION: primary breakpoint frames (the auto-created Desktop frame on each page) cannot be deleted. Reconfigure them with framer_set_node_attributes instead.",
    inputSchema: z.object({ nodeId: NodeId }),
    annotations: destructive,
    handler: async ({ nodeId }) => {
      await withFramer(async (f) => {
        await f.removeNodes([nodeId]);
        await assertRemoved(f, nodeId);
      });
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
