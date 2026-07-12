// Shared helpers: herdr plugin context, state paths, config, and server liveness.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface HerdrContext {
  worktree?: { path?: string }
  workspace?: { path?: string; id?: string }
  pane?: { id?: string; cwd?: string }
  agent?: Record<string, unknown>
  clicked_url?: string
}

export interface PluginConfig {
  /** Fixed port so an SSH LocalForward entry keeps working. */
  port: number
  /** "127.0.0.1" (default, tunnel over SSH) or "0.0.0.0" (tailnet/LAN, token-gated). */
  bind: string
  /** Extra URL host to advertise when bind is 0.0.0.0 (e.g. a tailscale IP/name). */
  advertiseHost?: string
}

const DEFAULT_CONFIG: PluginConfig = { port: 7777, bind: "127.0.0.1" }

export function readContext(): HerdrContext {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON
  if (!raw) return {}
  try {
    return JSON.parse(raw) as HerdrContext
  } catch {
    return {}
  }
}

export function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR ?? join(process.env.HOME ?? "/tmp", ".herdr-rich-preview")
  mkdirSync(dir, { recursive: true })
  return dir
}

export function configDir(): string {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? stateDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function loadConfig(): PluginConfig {
  const file = join(configDir(), "config.json")
  if (!existsSync(file)) return DEFAULT_CONFIG
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<PluginConfig>) }
  } catch {
    return DEFAULT_CONFIG
  }
}

/** Access token, generated once and reused so bookmarked URLs stay valid. */
export function loadToken(): string {
  const file = join(stateDir(), "token")
  if (existsSync(file)) return readFileSync(file, "utf8").trim()
  const token = crypto.randomUUID().replaceAll("-", "")
  writeFileSync(file, token, { mode: 0o600 })
  return token
}

export function pidFile(): string {
  return join(stateDir(), "server.pid")
}

/** Resolve the worktree root for this invocation: herdr context, then git, then cwd. */
export function resolveRoot(ctx: HerdrContext): string {
  const candidate = ctx.worktree?.path ?? ctx.pane?.cwd ?? ctx.workspace?.path ?? process.cwd()
  const git = Bun.spawnSync(["git", "-C", candidate, "rev-parse", "--show-toplevel"])
  if (git.exitCode === 0) return git.stdout.toString().trim()
  return candidate
}

export async function serverAlive(port: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health?t=${token}`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** True when this herdr server was reached over SSH (herdr --remote or ssh+herdr). */
export function isSshSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT)
}
