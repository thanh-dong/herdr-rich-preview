// Action entrypoint: ensure the preview server is running, register the focused
// worktree, then get the URL in front of the user — opened in the local browser
// when local, printed as a clickable link + tunnel one-liner over SSH.

import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  isSshSession,
  loadConfig,
  loadToken,
  pidFile,
  readContext,
  resolveRoot,
  serverAlive,
  stateDir,
} from "./context"

const config = loadConfig()
const token = loadToken()

async function stopServer() {
  const file = pidFile()
  if (!existsSync(file)) {
    console.log("rich-preview: server not running")
    return
  }
  const pid = Number(readFileSync(file, "utf8").trim())
  try {
    process.kill(pid)
    console.log(`rich-preview: stopped server (pid ${pid})`)
  } catch {
    console.log("rich-preview: server already gone")
  }
  rmSync(file, { force: true })
}

async function ensureServer(): Promise<void> {
  if (await serverAlive(config.port, token)) return
  const serverScript = join(import.meta.dir, "server.ts")
  const logPath = join(stateDir(), "server.log")
  const logFile = Bun.file(logPath)
  const proc = Bun.spawn(["bun", serverScript], {
    stdio: ["ignore", logFile, logFile],
    env: { ...process.env },
  })
  proc.unref()
  for (let i = 0; i < 20; i++) {
    if (await serverAlive(config.port, token)) return
    await Bun.sleep(250)
  }
  const tail = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").slice(-8).join("\n") : ""
  throw new Error(
    `rich-preview server failed to start on port ${config.port}.` +
      ` If the port is taken, set another in config.json (herdr plugin config-dir herdr-rich-preview).\n${tail}`,
  )
}

/** OSC 8 hyperlink so the URL is Ctrl/Cmd-clickable in the (possibly local) terminal. */
function hyperlink(url: string): string {
  return `]8;;${url}${url}]8;;`
}

/** OSC 52: copy to the clipboard — herdr's thin client bridges this to the local machine. */
function copyToClipboard(text: string) {
  process.stdout.write(`]52;c;${Buffer.from(text).toString("base64")}`)
}

export async function openPreview(extraQuery = ""): Promise<void> {
  await ensureServer()
  const ctx = readContext()
  const root = resolveRoot(ctx)

  await fetch(`http://127.0.0.1:${config.port}/api/register-root?t=${token}`, {
    method: "POST",
    body: JSON.stringify({ root }),
  })

  const query = `t=${token}&root=${encodeURIComponent(root)}${extraQuery}`
  const localUrl = `http://127.0.0.1:${config.port}/?${query}`

  if (!isSshSession()) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open"
    Bun.spawn([opener, localUrl], { stdio: ["ignore", "ignore", "ignore"] })
    console.log(`rich-preview: opened ${localUrl}`)
    return
  }

  // SSH session: the browser is on the other side of the connection.
  console.log("rich-preview (remote session)\n")
  if (config.bind !== "127.0.0.1" && config.advertiseHost) {
    const lanUrl = `http://${config.advertiseHost}:${config.port}/?${query}`
    console.log(`  Open directly (tailnet/LAN): ${hyperlink(lanUrl)}\n`)
    copyToClipboard(lanUrl)
    return
  }
  const user = process.env.USER ?? "you"
  const host = process.env.SSH_CONNECTION?.split(" ")[2] ?? "<this-host>"
  console.log(`  1. Tunnel once from your local machine:`)
  console.log(`       ssh -N -f -L ${config.port}:127.0.0.1:${config.port} ${user}@${host}`)
  console.log(`     (or add "LocalForward ${config.port} 127.0.0.1:${config.port}" to this host's ssh_config entry)\n`)
  console.log(`  2. Open: ${hyperlink(localUrl)}`)
  console.log(`     (copied to your clipboard)`)
  copyToClipboard(localUrl)
}

if (import.meta.main) {
  if (process.argv.includes("--stop")) {
    await stopServer()
  } else {
    await openPreview()
  }
}
