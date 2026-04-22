import type { Framer } from "framer-api";
import { FramerToolError } from "./framer-client.js";

/**
 * Framer's write APIs (cloneNode, setParent, addComponentInstance, removeNodes)
 * can succeed at the protocol level but land the node in a different place
 * than requested — or be silently reverted by Framer-side invariants (e.g. the
 * primary breakpoint frame that every page must have).
 *
 * These helpers re-read state after each write and raise actionable errors
 * when reality doesn't match intent.
 */

/** Verify `nodeId` is parented to `expectedParentId`. Throws with an actionable code if not. */
export async function assertParent(
  framer: Framer,
  nodeId: string,
  expectedParentId: string,
  operation: string,
): Promise<void> {
  const parent = await framer.getParent(nodeId).catch(() => null);
  const actualId = parent ? (parent as { id?: string }).id : null;
  if (actualId === expectedParentId) return;
  throw new FramerToolError(
    `${operation} placed node ${nodeId} under ${actualId ?? "null"} instead of the requested ${expectedParentId}.`,
    "Framer sometimes ignores parentId for cross-page moves or when the target parent does not accept this node type. Try framer_set_parent directly, or verify the target is on the same page.",
    "WRONG_PARENT",
  );
}

/** Verify `nodeId` no longer exists. Throws NODE_REINSTATIATED if Framer auto-recreated it. */
export async function assertRemoved(
  framer: Framer,
  nodeId: string,
): Promise<void> {
  const still = await framer.getNode(nodeId).catch(() => null);
  if (!still) return;
  throw new FramerToolError(
    `Node ${nodeId} was removed but Framer re-instantiated it immediately. This commonly happens for the primary breakpoint frame that every page must have.`,
    "If this is an auto-generated primary breakpoint, use framer_set_node_attributes to reconfigure it instead of removing. If it is user content, the project may be in view-only mode.",
    "NODE_REINSTATIATED",
  );
}

/** Best-effort cleanup that swallows errors. Used when rolling back partial writes. */
export async function bestEffortRemove(framer: Framer, nodeId: string): Promise<void> {
  try {
    await framer.removeNodes([nodeId]);
  } catch {
    // ignore — rollback is best-effort; the original error is what the caller surfaces
  }
}
