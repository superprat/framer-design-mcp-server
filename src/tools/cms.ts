import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Framer } from "framer-api";
import { z } from "zod";
import { FramerToolError, withFramer, withFramerWrite } from "../framer-client.js";
import { ok } from "../formatters.js";
import { NodeId, Pagination, paginate } from "../schemas.js";
import { registerTool } from "./register.js";

const readOnly = { readOnlyHint: true, idempotentHint: true };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const COLLECTION_KEYS = ["id", "name", "slugFieldName", "slugFieldBasedOn", "managedBy", "readonly"] as const;
const FIELD_KEYS = [
  "id",
  "name",
  "type",
  "required",
  "cases",
  "collectionId",
  "displayTime",
  "allowedFileTypes",
  "basedOn",
  "fields",
  "userEditable",
  "contentType",
] as const;
const ITEM_KEYS = ["id", "nodeId", "slug", "draft", "slugByLocale", "fieldData"] as const;

function pick<T extends string>(value: unknown, keys: readonly T[]): Record<string, unknown> {
  if (value == null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in v) {
      const x = v[k];
      if (typeof x !== "function") out[k] = x;
    }
  }
  return out;
}

const serializeCollection = (c: unknown) => pick(c, COLLECTION_KEYS);
const serializeField = (f: unknown) => pick(f, FIELD_KEYS);
const serializeItem = (it: unknown) => pick(it, ITEM_KEYS);

async function getCollectionOrThrow(f: Framer, collectionId: string) {
  const collection = await f.getCollection(collectionId);
  if (!collection) {
    throw new FramerToolError(
      `Collection ${collectionId} not found.`,
      undefined,
      "COLLECTION_NOT_FOUND",
    );
  }
  return collection;
}

const FieldsUpdateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("add"),
    collectionId: NodeId,
    fields: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe(
        "Array of CreateField objects. Each must include `type` and `name`. " +
          "Type union: 'boolean'|'string'|'formattedText'|'number'|'image'|'link'|'date'|'file'|'color'|'enum'|'collectionReference'|'multiCollectionReference'|'array'|'fieldDivider'. " +
          "Type-specific keys: enum→`cases: [{id, name}]`; collectionReference/multiCollectionReference→`collectionId`; date→optional `displayTime`; file→`allowedFileTypes: string[]`; array→`fields: [imageFieldDef]`. " +
          "Most non-divider types accept optional `required: boolean`.",
      ),
  }),
  z.object({
    mode: z.literal("remove"),
    collectionId: NodeId,
    fieldIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    mode: z.literal("setOrder"),
    collectionId: NodeId,
    fieldIds: z
      .array(z.string().min(1))
      .min(1)
      .describe("All existing field ids in the desired order."),
  }),
]);

export function registerCmsTools(server: McpServer) {
  // ---------- Read ----------

  registerTool(server, {
    name: "framer_list_collections",
    title: "List CMS collections",
    description:
      "Return every user-managed CMS Collection in the project with its metadata (id, name, slug field, managedBy). " +
      "Plugin-managed collections are not included; this server only edits user collections.",
    inputSchema: z.object({}),
    annotations: readOnly,
    handler: async () => {
      const collections = await withFramer((f) => f.getCollections());
      return ok({
        collections: collections.map(serializeCollection),
        count: collections.length,
      });
    },
  });

  registerTool(server, {
    name: "framer_get_collection",
    title: "Get CMS collection",
    description:
      "Fetch one Collection by id, optionally including its field schema. " +
      "Use this before writing items to learn the field ids/types you need to populate.",
    inputSchema: z.object({
      collectionId: NodeId,
      includeFields: z
        .boolean()
        .optional()
        .describe("Include the collection's field schema. Default true."),
    }),
    annotations: readOnly,
    handler: async ({ collectionId, includeFields }) => {
      const result = await withFramer(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        const out: Record<string, unknown> = { collection: serializeCollection(collection) };
        if (includeFields !== false) {
          const fields = await collection.getFields();
          out.fields = fields.map(serializeField);
        }
        return out;
      });
      return ok(result);
    },
  });

  registerTool(server, {
    name: "framer_list_collection_items",
    title: "List collection items",
    description:
      "Return items in a Collection, paginated. Each item exposes id, slug, draft status, and `fieldData` " +
      "(a `Record<fieldName, { type, value }>`). The Framer SDK has no native pagination — items are sliced client-side.",
    inputSchema: z.object({ collectionId: NodeId, ...Pagination }),
    annotations: readOnly,
    handler: async ({ collectionId, limit, offset }) => {
      const items = await withFramer(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        return collection.getItems();
      });
      const mapped = items.map(serializeItem);
      return ok(paginate(mapped, limit, offset) as unknown as Record<string, unknown>);
    },
  });

  registerTool(server, {
    name: "framer_get_collection_item",
    title: "Get collection item",
    description:
      "Fetch a single item by id, returning its slug, draft flag, and full fieldData. " +
      "Internally walks `Collection.getItems()` because the SDK has no per-id getter.",
    inputSchema: z.object({ collectionId: NodeId, itemId: NodeId }),
    annotations: readOnly,
    handler: async ({ collectionId, itemId }) => {
      const item = await withFramer(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        const items = await collection.getItems();
        const found = items.find((it) => (it as { id?: string }).id === itemId);
        if (!found) {
          throw new FramerToolError(
            `Item ${itemId} not found in collection ${collectionId}.`,
            undefined,
            "ITEM_NOT_FOUND",
          );
        }
        return found;
      });
      return ok({ item: serializeItem(item) });
    },
  });

  // ---------- Write — collection lifecycle ----------

  registerTool(server, {
    name: "framer_create_collection",
    title: "Create CMS collection",
    description:
      "Create a new user-managed Collection. Returns the new collection's id and metadata. " +
      "Add fields via framer_update_collection_fields with mode='add' before inserting items.",
    inputSchema: z.object({ name: z.string().min(1) }),
    annotations: mutation,
    handler: async ({ name }) => {
      const collection = await withFramerWrite((f) => f.createCollection(name));
      return ok({ collection: serializeCollection(collection) });
    },
  });

  registerTool(server, {
    name: "framer_update_collection_fields",
    title: "Update collection fields (add/remove/setOrder)",
    description:
      "Mutate a collection's field schema. Pick `mode`: " +
      "'add' to create new fields (`fields: CreateField[]`), " +
      "'remove' to delete by id (`fieldIds: string[]`), " +
      "'setOrder' to reorder (`fieldIds: string[]`, must list ALL existing field ids). " +
      "Returns the refreshed field list after the operation. " +
      "NOTE: Per-field renames or attribute changes (Field.setAttributes) are not exposed.",
    inputSchema: FieldsUpdateSchema,
    annotations: mutation,
    handler: async (input) => {
      const fields = await withFramerWrite(async (f) => {
        const collection = await getCollectionOrThrow(f, input.collectionId);
        if (input.mode === "add") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await collection.addFields(input.fields as any);
        } else if (input.mode === "remove") {
          await collection.removeFields(input.fieldIds);
        } else {
          await collection.setFieldOrder(input.fieldIds);
        }
        return collection.getFields();
      });
      return ok({ fields: fields.map(serializeField), count: fields.length });
    },
  });

  // ---------- Write — items ----------

  registerTool(server, {
    name: "framer_upsert_collection_items",
    title: "Upsert collection items",
    description:
      "Add or update items in a Collection. Mirrors `Collection.addItems`: " +
      "omit `id` to create a new item (slug required); include `id` to update an existing item. " +
      "Each item is `{ id?, slug?, draft?, fieldData?: Record<fieldName, { type, value }> }`. " +
      "`fieldData` value shape is per field type — strings: `{type:'string', value:'...'}`; " +
      "numbers: `{type:'number', value:42}`; booleans: `{type:'boolean', value:true}`; " +
      "image/file: `{type:'image'|'file', value: <asset url or null>}`; " +
      "color: `{type:'color', value:'#RRGGBB'|null}`; " +
      "date: `{type:'date', value:'YYYY-MM-DD'|epochMs|null}`; " +
      "link: `{type:'link', value:'https://…'|null}`; " +
      "enum: `{type:'enum', value:'<caseId>'}`; " +
      "collectionReference: `{type:'collectionReference', value:'<itemId>'|null}`; " +
      "multiCollectionReference: `{type:'multiCollectionReference', value:['<itemId>',…]|null}`; " +
      "formattedText: `{type:'formattedText', value:'<html or md>', contentType?:'html'|'markdown'}`. " +
      "Returns the affected items (matched by input id or slug) after the write.",
    inputSchema: z.object({
      collectionId: NodeId,
      items: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe("CollectionItemInput[] — see tool description for fieldData shape."),
    }),
    annotations: mutation,
    handler: async ({ collectionId, items }) => {
      const inputIds = new Set(
        items.map((it) => (it as Record<string, unknown>).id).filter((v): v is string => typeof v === "string"),
      );
      const inputSlugs = new Set(
        items.map((it) => (it as Record<string, unknown>).slug).filter((v): v is string => typeof v === "string"),
      );

      const affected = await withFramerWrite(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await collection.addItems(items as any);
        const after = await collection.getItems();
        return after.filter((it) => {
          const v = it as { id?: string; slug?: string };
          return (v.id && inputIds.has(v.id)) || (v.slug && inputSlugs.has(v.slug));
        });
      });

      return ok({
        affected: affected.map(serializeItem),
        count: affected.length,
      });
    },
  });

  registerTool(server, {
    name: "framer_remove_collection_items",
    title: "Remove collection items",
    description:
      "Delete items from a Collection by id. Idempotent: removing a non-existent id is not an error.",
    inputSchema: z.object({
      collectionId: NodeId,
      itemIds: z.array(z.string().min(1)).min(1),
    }),
    annotations: destructive,
    handler: async ({ collectionId, itemIds }) => {
      const remaining = await withFramerWrite(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        await collection.removeItems(itemIds);
        return collection.getItems();
      });
      return ok({
        removed: itemIds,
        remaining_count: remaining.length,
      });
    },
  });

  registerTool(server, {
    name: "framer_set_collection_item_order",
    title: "Set collection item order",
    description:
      "Reorder items in a Collection. `itemIds` must list ALL existing item ids in the desired order. " +
      "Returns the resulting item list.",
    inputSchema: z.object({
      collectionId: NodeId,
      itemIds: z.array(z.string().min(1)).min(1),
    }),
    annotations: mutation,
    handler: async ({ collectionId, itemIds }) => {
      const items = await withFramerWrite(async (f) => {
        const collection = await getCollectionOrThrow(f, collectionId);
        await collection.setItemOrder(itemIds);
        return collection.getItems();
      });
      return ok({ items: items.map(serializeItem), count: items.length });
    },
  });
}
