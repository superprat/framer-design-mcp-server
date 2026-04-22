#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerCodeTools } from "./tools/code.js";
import { registerInspectionTools } from "./tools/inspection.js";
import { registerPageAndNodeTools } from "./tools/pages-and-nodes.js";
import { registerStyleTools } from "./tools/styles.js";
import { registerVisualTools } from "./tools/visual.js";

async function main() {
  const server = new McpServer({
    name: "framer-design-mcp-server",
    version: "0.1.0",
  });

  registerInspectionTools(server);
  registerPageAndNodeTools(server);
  registerAssetTools(server);
  registerStyleTools(server);
  registerCodeTools(server);
  registerVisualTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("framer-design-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting framer-design-mcp-server:", err);
  process.exit(1);
});
