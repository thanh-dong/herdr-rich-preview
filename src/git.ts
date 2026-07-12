// Touched-files discovery, shared by the HTTP server and the pane TUI.

export function git(root: string, args: string[]): { ok: boolean; out: string } {
  const proc = Bun.spawnSync(["git", "-C", root, ...args])
  return { ok: proc.exitCode === 0, out: proc.stdout.toString() }
}

/** Modified + untracked + staged files, plus files changed vs the branch merge-base. */
export function touchedFiles(root: string): { path: string; status: string }[] {
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
