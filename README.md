# framer-design-mcp-server

An MCP server that lets an LLM **design web pages in a Framer project** via the
[Framer Server API](https://www.framer.com/developers/server-api-introduction)
(currently in open beta).

Scoped to page-design operations — create pages, frames, text, components,
styles, and code files; screenshot the result. **CMS and publishing workflows
are intentionally excluded** (see "Out of scope" below).

## Install

```bash
npm install
npm run build
```

## Node.js version

`framer-api` uses the global `WebSocket` constructor, which is built in on
**Node.js ≥ 22**. On Node 20 you must launch with `--experimental-websocket`.

```bash
# Node 22+
node dist/index.js

# Node 20 — flag required, else tools fail with "rr is not a constructor"
node --experimental-websocket dist/index.js
```

The Claude Desktop config in the next section includes the flag for Node 20
compatibility; remove it if you're on Node 22+.

## Configure

The server reads a single-project configuration from environment variables:

| Variable | Required | Description |
|---|---|---|
| `FRAMER_PROJECT_URL` | yes | e.g. `https://framer.com/projects/Sites--aabbccddeeff` |
| `FRAMER_API_KEY` | yes | Generate in Framer → Site Settings → General. The key is bound to this one project. |
| `FRAMER_LOG_LEVEL` | no | `error` \| `warn` \| `info` \| `debug` (default `warn`). Logs go to stderr. |

One server instance serves one project. Run multiple instances with different
env files to target multiple projects.

## Run

Add to an MCP client (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "framer-design": {
      "command": "/absolute/path/to/node",
      "args": ["--experimental-websocket", "/absolute/path/to/framer-design-mcp-server/dist/index.js"],
      "env": {
        "FRAMER_PROJECT_URL": "https://framer.com/projects/Sites--aabbccddeeff",
        "FRAMER_API_KEY": "ap_..."
      }
    }
  }
}
```

Or inspect interactively:

```bash
FRAMER_PROJECT_URL=... FRAMER_API_KEY=... npm run inspect
```

## Tool catalogue

27 tools prefixed `framer_`. All open a fresh Framer connection per call (via
`withConnection`), retry transient SDK errors, and return structured JSON.

| Group | Tools |
|---|---|
| Inspection (read-only) | `get_project_info`, `get_current_user`, `get_canvas_root`, `list_pages`, `get_node`, `get_node_children`, `get_node_parent`, `get_node_rect`, `find_nodes_by_type`, `find_nodes_by_attribute` |
| Pages | `create_web_page`, `create_design_page` |
| Nodes | `create_frame`, `create_text_node`, `create_component_node`, `add_component_instance`, `set_node_attributes`, `set_text`, `set_parent`, `clone_node`, `remove_node`, `add_svg` |
| Assets | `upload_image`, `add_image`, `upload_file` |
| Styles | `list_color_styles`, `create_color_style`, `list_text_styles`, `create_text_style`, `list_fonts` |
| Code | `list_code_files`, `get_code_file`, `create_code_file`, `typecheck_code` |
| Visual | `screenshot_node`, `export_svg` |

### Design-feedback loop

`framer_screenshot_node` returns PNG/JPEG as inline MCP image content — an
agent can call it after every design edit to visually verify the result before
continuing.

## Out of scope

These Framer Server API surfaces are **not** exposed by this server:

- CMS — `getCollections`, `addItems`, `createCollection`, field management
- Publishing — `publish`, `deploy`, `getChangedPaths`, `getChangeContributors`
- Redirects, localization

If you need them, a separate `tools/cms.ts` / `tools/publishing.ts` module can
be added; all would share the existing `withFramer` wrapper.

## Evaluation

See [evals/framer-design-eval.xml](evals/framer-design-eval.xml) for 10 Q/A
pairs that validate this server against a seeded test project. The eval
questions assume a fixture Framer project — read the comment at the top of the
eval file for seed requirements.

## References

- [Framer Server API — Introduction](https://www.framer.com/developers/server-api-introduction)
- [Framer Server API — Reference](https://www.framer.com/developers/server-api-reference)
- [framer-api on npm](https://www.npmjs.com/package/framer-api)
- [Official examples (GitHub)](https://github.com/framer/server-api-examples)
