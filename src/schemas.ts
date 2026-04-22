import { z } from "zod";

export const NodeId = z.string().min(1).describe("Framer node id (e.g. 'abc123').");

export const Pagination = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max items to return. Default 50."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Items to skip. Default 0."),
};

export function paginate<T>(items: readonly T[], limit = 50, offset = 0) {
  const total = items.length;
  const slice = items.slice(offset, offset + limit);
  return {
    items: slice,
    total,
    count: slice.length,
    offset,
    has_more: offset + slice.length < total,
    next_offset: offset + slice.length < total ? offset + slice.length : null,
  };
}

export const PaginationOutputShape = {
  total: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().nullable(),
};

export const ResponseFormat = z
  .enum(["json", "markdown"])
  .optional()
  .describe("Output style. Default 'json' (structured). 'markdown' returns a human-readable list.");

export type ResponseFormat = z.infer<typeof ResponseFormat>;

/** Loose attribute object used when forwarding to SDK setAttributes / createFrameNode etc. */
export const LooseAttributes = z
  .record(z.string(), z.unknown())
  .describe(
    "Partial node attributes to set. See the Framer Plugin API docs for per-node-type editable attributes (e.g. width, height, backgroundColor, name).",
  );
