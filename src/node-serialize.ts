/**
 * Node serialization helpers.
 *
 * Framer SDK node objects are class instances with attribute values exposed
 * via readonly properties on the instance and/or prototype getters. We need to
 * return a flat, JSON-safe object that captures every attribute an agent is
 * likely to care about — including `componentIdentifier`, `url`, layout
 * traits, etc. — while skipping functions and unbounded reference loops.
 *
 * Strategy:
 * 1. Probe a broad whitelist of attribute keys using `in` (picks up getters on
 *    the prototype chain too).
 * 2. Also pick up any enumerable own keys the SDK exposes.
 * 3. For object values, JSON round-trip with a depth cap to flatten nested
 *    value objects (Color, Font, Rect, etc.) to plain data.
 */

const MAX_DEPTH = 4;
const MAX_VALUE_CHARS = 8_000;

/** Union of known attribute keys across Framer node classes.
 * Adding unknown keys is harmless: `in` gates reads so absent keys are skipped. */
const NODE_ATTR_KEYS: readonly string[] = [
  // Core / identity
  "__class",
  "id",
  "name",
  "path",
  "visible",
  "locked",
  // Position & size
  "position",
  "x",
  "y",
  "width",
  "height",
  "widthConstraint",
  "heightConstraint",
  "aspectRatio",
  "rotation",
  "opacity",
  "zIndex",
  "overflow",
  "pins",
  // Background / fill
  "backgroundColor",
  "backgroundImage",
  "backgroundGradient",
  "borderRadius",
  "border",
  // Layout
  "layout",
  "direction",
  "distribution",
  "alignment",
  "gap",
  "padding",
  "stackAlignment",
  "gridLayout",
  "gridItemColumnSpan",
  "gridItemAlignment",
  // Text
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlignment",
  "textTransform",
  "textDecoration",
  "textTruncation",
  "inlineTextStyle",
  "color",
  // Links / images / SVG
  "link",
  "linkRel",
  "image",
  "imageRendering",
  "svg",
  // Components
  "componentIdentifier",
  "componentURL",
  "url",
  "controls",
  "componentInfo",
  "componentProps",
  "props",
  "isBreakpoint",
  "isComponentVariant",
  "breakpoint",
  // Pages
  "pagePath",
  "pageName",
  "pageScope",
  // Misc
  "shadow",
  "transition",
] as const;

/** Keys we should NEVER serialize — internal state, noisy, or self-referential. */
const DENYLIST = new Set([
  "__proto__",
  "constructor",
  "engine",
  "_engine",
  "parent",
  "children",
  "childrenIds",
  "parentNode",
  "root",
]);

function isPlainPrimitive(v: unknown): v is string | number | boolean | null | undefined {
  return v === null || v === undefined || typeof v !== "object";
}

function safeJsonClone(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[depth-capped]";
  if (isPlainPrimitive(value)) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => safeJsonClone(v, depth + 1));
  }
  // Objects (including class instances)
  const out: Record<string, unknown> = {};
  const obj = value as Record<string, unknown>;
  // Try enumerable own keys first; fall back to known keys for getters.
  const seen = new Set<string>();
  for (const k of Object.keys(obj)) {
    if (DENYLIST.has(k)) continue;
    seen.add(k);
    const v = obj[k];
    if (typeof v === "function") continue;
    out[k] = safeJsonClone(v, depth + 1);
  }
  return out;
}

/**
 * Serialize a Framer SDK node instance to a plain JSON-safe object with as
 * many attribute values as we can recover. Skips functions and caps depth.
 */
export function serializeNode(n: unknown): Record<string, unknown> {
  if (n == null || typeof n !== "object") return {};
  const node = n as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // 1. Known attribute keys (picks up prototype getters via `in`).
  for (const k of NODE_ATTR_KEYS) {
    if (!(k in node)) continue;
    if (DENYLIST.has(k)) continue;
    const v = node[k];
    if (typeof v === "function") continue;
    out[k] = safeJsonClone(v, 1);
  }

  // 2. Any enumerable own keys the SDK exposes that we missed.
  for (const k of Object.keys(node)) {
    if (k in out || DENYLIST.has(k) || k.startsWith("_") || k.startsWith("#")) continue;
    const v = node[k];
    if (typeof v === "function") continue;
    out[k] = safeJsonClone(v, 1);
  }

  // 3. Guard against pathologically large outputs.
  const serialized = JSON.stringify(out);
  if (serialized.length > MAX_VALUE_CHARS) {
    return {
      __class: out.__class,
      id: out.id,
      name: out.name,
      _note: `Node serialization exceeded ${MAX_VALUE_CHARS} chars and was truncated. Read specific attributes via framer_set_node_attributes or narrow the scope.`,
    };
  }
  return out;
}

/** Compact identity fields only — useful for pagination lists. */
export function nodeIdentity(n: unknown): Record<string, unknown> {
  if (n == null || typeof n !== "object") return {};
  const node = n as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["__class", "id", "name", "path"]) {
    if (k in node) {
      const v = node[k];
      if (typeof v !== "function") out[k] = v;
    }
  }
  return out;
}
