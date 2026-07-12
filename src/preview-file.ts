// Link-handler / action entrypoint: open the preview focused on one file.
// Herdr passes the Ctrl-clicked file:// URL in HERDR_PLUGIN_CONTEXT_JSON.

import { fileURLToPath } from "node:url"
import { relative } from "node:path"
import { readContext, resolveRoot } from "./context"
import { openPreview } from "./open-preview"

const ctx = readContext()
const root = resolveRoot(ctx)

let file = process.argv[2] ?? ""
if (!file && ctx.clicked_url?.startsWith("file://")) {
  file = fileURLToPath(ctx.clicked_url)
}
if (file.startsWith("/")) file = relative(root, file)

await openPreview(file ? `&file=${encodeURIComponent(file)}` : "")
