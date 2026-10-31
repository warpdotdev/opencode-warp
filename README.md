# OpenCode + Warp

Official [Warp](https://warp.dev) terminal integration for [OpenCode](https://opencode.ai).

## Features

### 🔔 Native Notifications

Get native Warp notifications when OpenCode:

- **Completes a task** — with a summary showing your prompt and the response
- **Needs your input** — when a permission request is pending
- **Runs a tool** — status updates as tools execute

Notifications appear in Warp's notification center and as system notifications, so you can context-switch while OpenCode works and get alerted when attention is needed.

## Installation

### From npm (recommended)

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@warp-dot-dev/opencode-warp"]
}
```

### From local files

Build the package, then point OpenCode at the built `dist` directory (not only `index.js`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-warp/dist"]
}
```

Restart the OpenCode CLI after changing the plugin. V2 automatically loads the package's
`./tui` entrypoint alongside the main plugin. Notifications run in the CLI, not in the
background service, so they reach the Warp terminal attached to that CLI. For a remote
server, add the package to `plugins` in your local `~/.config/opencode/cli.json` as well.

### OpenCode V1

All OpenCode V1 users must pin the plugin to `0.1.7` using the V1 `plugin` key:

```json
{
  "plugin": ["@warp-dot-dev/opencode-warp@0.1.7"]
}
```

## Requirements

- [Warp terminal](https://warp.dev) (macOS, Linux, or Windows)
- [OpenCode](https://opencode.ai) CLI (V2: 2.0.18 or newer; V1: see above)

## How It Works

This plugin uses Warp's [pluggable notifications](https://docs.warp.dev/features/notifications) feature via OSC escape sequences. When OpenCode triggers an event, the plugin:

1. Reads event data from OpenCode's plugin API
2. Formats a concise notification payload
3. Sends an OSC 777 escape sequence to Warp, which displays a native notification

On V2, the CLI plugin listens to session creation, inbox admission, execution completion,
permissions, forms, and tool lifecycle events. It suppresses notifications for subagent
sessions and only notifies for the session currently displayed in this CLI and its open root-session
tabs; other terminals' sessions are ignored. Queued prompts notify when delivered, not
while waiting in the inbox.

## Configuration

Notifications work out of the box. To customize Warp's notification behavior (sounds, system notifications, etc.), see [Warp's notification settings](https://docs.warp.dev/features/notifications).

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

## Uninstall

Remove `"@warp-dot-dev/opencode-warp"` from the `plugins` array in your `opencode.json`
(V1: `plugin`), and from `cli.json` if you added it there.

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/warpdotdev/opencode-warp).

## License

MIT License — see [LICENSE](LICENSE) for details.
