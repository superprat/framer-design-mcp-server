import type { Framer } from "framer-api";

/**
 * Collect every descendant id of `rootId` (inclusive) by BFS via `getChildren`.
 * Bounded by `maxNodes` to protect against pathological trees. Returns the full
 * set as well as a boolean indicating whether the walk was truncated.
 */
export async function walkDescendants(
  framer: Framer,
  rootId: string,
  maxNodes = 5_000,
): Promise<{ ids: Set<string>; truncated: boolean }> {
  const ids = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  let truncated = false;

  while (queue.length > 0) {
    if (ids.size >= maxNodes) {
      truncated = true;
      break;
    }
    const next = queue.shift()!;
    let children: unknown[] = [];
    try {
      children = await framer.getChildren(next);
    } catch {
      // Some nodes (e.g. primary breakpoint frames under certain conditions)
      // reject getChildren. Skip; they'll be excluded from the scope.
      continue;
    }
    for (const c of children) {
      const cid = (c as { id?: string }).id;
      if (!cid || ids.has(cid)) continue;
      ids.add(cid);
      queue.push(cid);
    }
  }

  return { ids, truncated };
}

/** Collect descendants as the serialized nodes themselves (not just ids). */
export async function walkDescendantNodes(
  framer: Framer,
  rootId: string,
  maxNodes = 5_000,
): Promise<{ nodes: unknown[]; truncated: boolean }> {
  const nodes: unknown[] = [];
  const seen = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  let truncated = false;

  while (queue.length > 0) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    const next = queue.shift()!;
    const self = await framer.getNode(next).catch(() => null);
    if (self) nodes.push(self);

    let children: unknown[] = [];
    try {
      children = await framer.getChildren(next);
    } catch {
      continue;
    }
    for (const c of children) {
      const cid = (c as { id?: string }).id;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      queue.push(cid);
    }
  }

  return { nodes, truncated };
}
