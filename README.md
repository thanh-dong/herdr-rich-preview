# herdr-rich-preview

Browser-based **rich preview of the files an AI agent touched in your herdr session**: rendered markdown (with inline mermaid fences), mermaid `.mmd`, D2 diagrams, styled HTML (sandboxed iframe), SVG, images, and syntax-highlighted code. The file classification mirrors [Shuttle](https://github.com/)'s touched-file preview, so both UIs render the same file the same way.

herdr plugin panes are terminals, so true diagram/HTML rendering can't happen in a pane — this plugin instead runs a small read-only Bun server on the herdr host and opens the preview in your browser. Because the server runs where herdr runs, the **same code path works locally and over `herdr --remote` (SSH)**; only URL reachability differs.

## Requirements

- [Bun](https://bun.sh) on the herdr host
- Optional: [`d2`](https://d2lang.com) CLI on the herdr host for D2 rendering

## Install

```bash
herdr plugin install <owner>/herdr-rich-preview
```

Bind a key in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+p"
type = "shell"
command = "herdr plugin action invoke open-preview --plugin herdr-rich-preview"
```

## Usage

- **`open-preview`** — starts (or reuses) the preview server and opens the browser on the focused pane's worktree. The sidebar lists the session's touched files (`git status` + merge-base diff) with live refresh; the open file re-renders when the agent writes to it.
- **`preview-file`** — link handler: Ctrl+click a `file://…​.md|.mmd|.d2|.html|.svg` URL in any pane to jump straight to that file's preview.
- **`stop-server`** — stops the background server.

## SSH / `herdr --remote`

The plugin (and its server) run on the **remote** host; your browser is local. `open-preview` detects the SSH session and:

1. Prints a one-shot tunnel command — `ssh -N -f -L 7777:127.0.0.1:7777 you@host` — and suggests a permanent `LocalForward 7777 127.0.0.1:7777` line for that host's `ssh_config` entry (the port is fixed by design so the forward keeps working).
2. Prints the preview URL as a clickable OSC 8 hyperlink and copies it to your **local** clipboard via OSC 52 (bridged by herdr's thin client).

Alternatively, for tailnet/LAN access without a tunnel, set in the plugin config dir (`herdr plugin config-dir herdr-rich-preview`) a `config.json`:

```json
{ "bind": "0.0.0.0", "advertiseHost": "my-machine.tailnet.ts.net" }
```

Every URL carries a per-install random token; the server is read-only and only serves worktrees you explicitly opened.

## Development

```bash
herdr plugin link /path/to/herdr-rich-preview
bun test
```
