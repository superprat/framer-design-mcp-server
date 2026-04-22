import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withFramer, FramerToolError } from "../framer-client.js";
import { ok } from "../formatters.js";
import { registerTool } from "./register.js";

const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

/** Shared schema for an image/file input. Either a public URL or raw bytes. */
const ImageInput = z.object({
  name: z.string().optional().describe("Display name for the asset."),
  url: z
    .string()
    .url()
    .optional()
    .describe("Public URL Framer can fetch. Mutually exclusive with bytesBase64."),
  bytesBase64: z
    .string()
    .optional()
    .describe("Base64-encoded bytes. Requires mimeType. Mutually exclusive with url."),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type, required when bytesBase64 is provided, e.g. 'image/png'."),
});

type ImageInput = z.infer<typeof ImageInput>;

function validateImageInput(input: ImageInput): void {
  if (!input.url === !input.bytesBase64) {
    throw new FramerToolError(
      "Provide exactly one of `url` or `bytesBase64`.",
      undefined,
      "INVALID_ARGUMENTS",
    );
  }
  if (input.bytesBase64 && !input.mimeType) {
    throw new FramerToolError(
      "`mimeType` is required when supplying `bytesBase64`.",
      undefined,
      "INVALID_ARGUMENTS",
    );
  }
}

function toNamedImageAssetInput(input: ImageInput) {
  validateImageInput(input);
  if (input.url) {
    return { name: input.name, image: input.url };
  }
  const bytes = Buffer.from(input.bytesBase64 ?? "", "base64");
  return {
    name: input.name,
    image: {
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType: input.mimeType!,
    },
  };
}

function toNamedFileAssetInput(input: ImageInput) {
  validateImageInput(input);
  if (input.url) {
    return { name: input.name, file: input.url };
  }
  const bytes = Buffer.from(input.bytesBase64 ?? "", "base64");
  return {
    name: input.name,
    file: {
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType: input.mimeType!,
    },
  };
}

export function registerAssetTools(server: McpServer) {
  registerTool(server, {
    name: "framer_upload_image",
    title: "Upload image",
    description:
      "Upload an image to the project's asset library without inserting it onto the canvas. Returns an ImageAsset reference for use with framer_set_node_attributes.",
    inputSchema: z.object({ image: ImageInput }),
    annotations: mutation,
    handler: async ({ image }) => {
      const asset = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.uploadImage(toNamedImageAssetInput(image) as any),
      );
      return ok({ asset: asset as unknown as Record<string, unknown> });
    },
  });

  registerTool(server, {
    name: "framer_add_image",
    title: "Add image to canvas",
    description: "Upload and insert an image onto the canvas in one step.",
    inputSchema: z.object({ image: ImageInput }),
    annotations: mutation,
    handler: async ({ image }) => {
      await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.addImage(toNamedImageAssetInput(image) as any),
      );
      return ok({ added: true });
    },
  });

  registerTool(server, {
    name: "framer_upload_file",
    title: "Upload file",
    description: "Upload a file asset (non-image) to the project.",
    inputSchema: z.object({ file: ImageInput }),
    annotations: mutation,
    handler: async ({ file }) => {
      const asset = await withFramer((f) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.uploadFile(toNamedFileAssetInput(file) as any),
      );
      return ok({ asset: asset as unknown as Record<string, unknown> });
    },
  });
}
