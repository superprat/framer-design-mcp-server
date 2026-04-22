/**
 * A single process-wide mutex for write operations against the Framer API.
 *
 * Why: Framer's server keeps implicit state (notably the "currently selected"
 * page / node) that write operations read from. When an MCP client fires
 * multiple writes in parallel, those two operations race on that shared
 * state, and one or both can land nodes in the wrong place (e.g. a
 * create_frame with parentId=X lands under the home page instead because
 * another create invoked in the same turn has changed the selection).
 *
 * Serializing every write through this mutex eliminates the race — at the
 * cost of making parallel write calls sequential. Reads are NOT serialized.
 *
 * Set the env var FRAMER_DISABLE_WRITE_MUTEX=1 to opt out (not recommended).
 */

let chain: Promise<unknown> = Promise.resolve();

export function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.FRAMER_DISABLE_WRITE_MUTEX === "1") {
    return fn();
  }
  const next = chain.then(fn, fn);
  // Keep the chain alive even if this task throws — later tasks must still run.
  chain = next.catch(() => undefined);
  return next;
}
