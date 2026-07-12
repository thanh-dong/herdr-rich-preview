// Pane mode: an in-terminal approximation of the rich preview, for quick glances
// without leaving herdr (and for clients like Termius with no local tunnel).
//
// Fidelity is bounded by terminal graphics: markdown renders via glow, mermaid/D2
// render to SVG (mmdc / d2) and display via chafa as ANSI art, images via chafa.
// Styled HTML has no terminal path — the pane points to the browser URL instead.
//
// Usage: interactive TUI by default; `--render <file>` prints one file and exits.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { inferPreviewRenderer } from "./preview-renderer"
import { loadConfig, loadToken, readContext, resolveRoot, stateDir } from "./context"
import { touchedFiles } from "./git"

const ctx = readContext()
const root = resolveRoot(ctx)
const config = loadConfig()
const token = loadToken()

const cols = () => process.stdout.columns ?? 80
const rows = () => process.stdout.rows ?? 24

const has = (tool: string) => Bun.which(tool) !== null

function run(cmd: string[], stdin?: string): { ok: boolean; out: string; err: string } {
  try {
    const proc = Bun.spawnSync(cmd, stdin ? { stdin: Buffer.from(stdin) } : {})
    return { ok: proc.exitCode === 0, out: proc.stdout.toString(), err: proc.stderr.toString() }
  } catch {
    return { ok: false, out: "", err: `${cmd[0]} not installed` }
  }
}

function chafa(file: string): string {
  const res = run(["chafa", `--size=${cols() - 2}x${rows() - 6}`, file])
  return res.ok ? res.out : `(chafa failed: ${res.err.trim()})`
}

/** Render SVG markup through chafa via a temp file. */
function chafaSvg(svg: string): string {
  const tmp = join(stateDir(), "pane-render.svg")
  writeFileSync(tmp, svg)
  const out = chafa(tmp)
  rmSync(tmp, { force: true })
  return out
}

function plain(content: string, note?: string): string {
  const head = content.split("\n").slice(0, rows() * 3).join("\n")
  return (note ? `${note}\n\n` : "") + head
}

function browserHint(file?: string): string {
  const query = `t=${token}&root=${encodeURIComponent(root)}${file ? `&file=${encodeURIComponent(file)}` : ""}`
  return `http://127.0.0.1:${config.port}/?${query}`
}

export function renderFile(relPath: string): string {
  const abs = resolve(root, relPath)
  if (!existsSync(abs)) return `not found: ${relPath}`
  const renderer = inferPreviewRenderer(relPath)

  if (renderer.kind === "image") return chafa(abs)

  const content = readFileSync(abs, "utf8")

  if (renderer.kind === "markdown") {
    if (has("glow")) {
      const res = run(["glow", "-s", "auto", "-w", String(Math.min(cols() - 2, 110)), abs])
      if (res.ok) return res.out
    }
    return plain(content, "(install `glow` for styled markdown)")
  }

  if (renderer.kind === "embed") {
    if (renderer.format === "svg") return chafaSvg(content)
    if (renderer.format === "d2") {
      if (has("d2")) {
        const res = run(["d2", "-", "-"], content)
        if (res.ok) return chafaSvg(res.out)
        return plain(content, `(d2 failed: ${res.err.trim().split("\n")[0]})`)
      }
      return plain(content, "(install `d2` to render this diagram)")
    }
    if (renderer.format === "mermaid") {
      if (has("mmdc")) {
        const tmpIn = join(stateDir(), "pane-render.mmd")
        const tmpOut = join(stateDir(), "pane-render-mmd.svg")
        writeFileSync(tmpIn, content)
        const res = run(["mmdc", "-i", tmpIn, "-o", tmpOut, "--quiet"])
        const out = res.ok && existsSync(tmpOut) ? chafa(tmpOut) : plain(content, `(mmdc failed)`)
        rmSync(tmpIn, { force: true })
        rmSync(tmpOut, { force: true })
        return out
      }
      return plain(content, "(install mermaid-cli `mmdc` to render this diagram)")
    }
    // html: no terminal rendering path.
    return plain(content, `(HTML has no terminal preview — open ${browserHint(relPath)})`)
  }

  if (renderer.kind === "unsupported") return "(no preview for this file type)"
  return plain(content)
}

// ---------- TUI ----------

const ESC = "\x1b"
const clear = () => process.stdout.write(`${ESC}[2J${ESC}[H`)
const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`
const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`
const invert = (s: string) => `${ESC}[7m${s}${ESC}[0m`

function drawList(files: { path: string; status: string }[], selected: number) {
  clear()
  console.log(bold(` Rich Preview — ${root.split("/").pop()}`))
  console.log(dim(` browser: ${browserHint()}`))
  console.log()
  if (!files.length) console.log(dim("  no files touched in this session yet"))
  const visible = files.slice(0, rows() - 7)
  visible.forEach((f, i) => {
    const line = ` ${f.status[0]} ${f.path}`
    console.log(i === selected ? invert(line) : line)
  })
  console.log()
  console.log(dim(" j/k move · enter preview · r refresh · q quit"))
}

function drawFile(files: { path: string; status: string }[], index: number) {
  clear()
  const f = files[index]
  console.log(bold(` ${f.path}`) + dim(`  (${index + 1}/${files.length})`))
  console.log(dim(` browser: ${browserHint(f.path)}`))
  console.log()
  console.log(renderFile(f.path))
  console.log(dim(" j/k next/prev file · esc/q back to list"))
}

async function tui() {
  let files = touchedFiles(root)
  let selected = 0
  let mode: "list" | "file" = "list"

  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  drawList(files, selected)

  for await (const chunk of process.stdin) {
    const key = chunk.toString()
    if (mode === "list") {
      if (key === "q" || key === "\x03") break
      if (key === "r") files = touchedFiles(root)
      if ((key === "j" || key === `${ESC}[B`) && selected < files.length - 1) selected++
      if ((key === "k" || key === `${ESC}[A`) && selected > 0) selected--
      if (key === "\r" && files.length) { mode = "file"; drawFile(files, selected); continue }
      drawList(files, selected)
    } else {
      if (key === "q" || key === ESC || key === "\x03") { mode = "list"; drawList(files, selected); continue }
      if (key === "j" && selected < files.length - 1) selected++
      if (key === "k" && selected > 0) selected--
      drawFile(files, selected)
    }
  }
  clear()
  process.exit(0)
}

if (import.meta.main) {
  const renderArg = process.argv.indexOf("--render")
  if (renderArg !== -1) {
    console.log(renderFile(process.argv[renderArg + 1] ?? ""))
  } else {
    await tui()
  }
}
