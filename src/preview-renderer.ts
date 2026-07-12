// Maps a file path to how its preview should render. Pure and UI-free.
// Extracted from Shuttle's src/client/lib/previewRenderer.ts so both UIs
// classify files identically.

export type PreviewEmbedFormat = "html" | "svg" | "mermaid" | "d2"

export type PreviewRenderer =
  | { kind: "markdown" }
  | { kind: "embed"; format: PreviewEmbedFormat }
  | { kind: "image"; mime: string }
  | { kind: "code"; language: string | null }
  | { kind: "unsupported" }

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
}

const EMBED_BY_EXTENSION: Record<string, PreviewEmbedFormat> = {
  html: "html",
  htm: "html",
  svg: "svg",
  mmd: "mermaid",
  mermaid: "mermaid",
  d2: "d2",
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"])

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "json", "css", "scss", "xml", "sh", "bash", "zsh",
  "py", "rs", "go", "java", "rb", "php", "yml", "yaml", "sql", "toml", "lua",
])

// Readable as text but not renderable as text — show "preview unavailable".
const UNSUPPORTED_EXTENSIONS = new Set([
  "ico", "tiff",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "mov", "webm", "mp3", "wav", "ogg", "flac",
  "exe", "dll", "so", "dylib", "bin", "wasm", "class", "jar",
])

function getExtension(path: string): string {
  const base = path.split("/").pop() ?? ""
  if (!base.includes(".")) return ""
  return base.split(".").pop()?.toLowerCase() ?? ""
}

export function inferPreviewRenderer(path: string): PreviewRenderer {
  const extension = getExtension(path)

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { kind: "markdown" }
  }

  const embedFormat = EMBED_BY_EXTENSION[extension]
  if (embedFormat) {
    return { kind: "embed", format: embedFormat }
  }

  const imageMime = IMAGE_MIME_BY_EXTENSION[extension]
  if (imageMime) {
    return { kind: "image", mime: imageMime }
  }

  if (UNSUPPORTED_EXTENSIONS.has(extension)) {
    return { kind: "unsupported" }
  }

  return { kind: "code", language: CODE_EXTENSIONS.has(extension) ? extension : null }
}
