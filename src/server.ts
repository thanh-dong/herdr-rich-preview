// Rich-preview HTTP server. Runs on the machine where herdr (and the code) lives,
// so the same code path serves local and --remote (SSH) sessions; only URL
// reachability differs (see open-preview.ts).
//
// Read-only by construction: it never writes inside a worktree. Every route
// requires the per-install token (?t=). Roots are limited to git worktrees the
// opener explicitly registered via /api/register-root.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, normalize, resolve } from "node:path"
import { IMAGE_MIME_BY_EXTENSION, inferPreviewRenderer } from "./preview-renderer"
import { loadConfig, loadToken, pidFile, stateDir } from "./context"

const config = loadConfig()
const token = loadToken()
const rootsFile = join(stateDir(), "roots.json")

function loadRoots(): string[] {
  try {
    return JSON.parse(readFileSync(rootsFile, "utf8")) as string[]
  } catch {
    return []
  }
}

function saveRoots(roots: string[]) {
  writeFileSync(rootsFile, JSON.stringify([...new Set(roots)]))
}

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const proc = Bun.spawnSync(["git", "-C", root, ...args])
  return { ok: proc.exitCode === 0, out: proc.stdout.toString() }
}

/** Modified + untracked + staged files, plus files changed vs the branch merge-base. */
function touchedFiles(root: string): { path: string; status: string }[] {
  const seen = new Map<string, string>()
  const status = git(root, ["status", "--porcelain", "-uall"])
  if (status.ok) {
    for (const line of status.out.split("\n")) {
      if (!line.trim()) continue
      const flag = line.slice(0, 2).trim() || "M"
      // Rename lines are "R  old -> new"; keep the new path.
      const path = (line.slice(3).split(" -> ").pop() ?? "").trim()
      if (path) seen.set(path, flag)
    }
  }
  const base = git(root, ["merge-base", "HEAD", "origin/HEAD"])
  if (base.ok) {
    const diff = git(root, ["diff", "--name-status", base.out.trim(), "HEAD"])
    if (diff.ok) {
      for (const line of diff.out.split("\n")) {
        const [flag, ...rest] = line.split("\t")
        const path = rest.pop()
        if (path && !seen.has(path)) seen.set(path, flag?.[0] ?? "M")
      }
    }
  }
  return [...seen.entries()]
    .map(([path, status]) => ({ path, status }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Resolve a request path inside a registered root; null if it escapes. */
function safeResolve(root: string, relPath: string): string | null {
  const abs = resolve(root, normalize(relPath))
  if (abs !== root && !abs.startsWith(root + "/")) return null
  return abs
}

function renderD2(source: string): { ok: boolean; svg?: string; error?: string } {
  const proc = Bun.spawnSync(["d2", "-", "-"], { stdin: Buffer.from(source) })
  if (proc.exitCode !== 0) {
    return { ok: false, error: proc.stderr.toString().trim() || "d2 CLI not available" }
  }
  return { ok: true, svg: proc.stdout.toString() }
}

const server = Bun.serve({
  hostname: config.bind,
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.searchParams.get("t") !== token) return unauthorized()

    if (url.pathname === "/api/health") return json({ ok: true, pid: process.pid })

    if (url.pathname === "/api/register-root" && req.method === "POST") {
      const { root } = (await req.json()) as { root?: string }
      if (!root || !existsSync(root)) return json({ error: "no such root" }, 400)
      saveRoots([...loadRoots(), resolve(root)])
      return json({ ok: true })
    }

    if (url.pathname === "/api/roots") return json({ roots: loadRoots() })

    const root = url.searchParams.get("root") ?? ""
    if (url.pathname.startsWith("/api/") && !loadRoots().includes(root)) {
      return json({ error: "root not registered" }, 403)
    }

    if (url.pathname === "/api/files") {
      const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
      return json({
        root,
        branch: branch.ok ? branch.out.trim() : null,
        files: touchedFiles(root).map((f) => ({ ...f, renderer: inferPreviewRenderer(f.path) })),
      })
    }

    if (url.pathname === "/api/file") {
      const rel = url.searchParams.get("path") ?? ""
      const abs = safeResolve(root, rel)
      if (!abs || !existsSync(abs)) return json({ error: "not found" }, 404)
      const renderer = inferPreviewRenderer(rel)
      const mtime = statSync(abs).mtimeMs
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (renderer.kind === "image") {
        const data = readFileSync(abs).toString("base64")
        return json({ path: rel, renderer, mtime, encoding: "base64", mimeType: IMAGE_MIME_BY_EXTENSION[ext], content: data })
      }
      const content = readFileSync(abs, "utf8")
      if (renderer.kind === "embed" && renderer.format === "d2") {
        const d2 = renderD2(content)
        return json({ path: rel, renderer, mtime, content, d2 })
      }
      return json({ path: rel, renderer, mtime, content })
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8")
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    }

    return new Response("not found", { status: 404 })
  },
})

writeFileSync(pidFile(), String(process.pid))
console.log(`herdr-rich-preview serving on http://${config.bind}:${server.port} (token required)`)
