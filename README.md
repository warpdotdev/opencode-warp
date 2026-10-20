# OpenCode + Warp

Official [Warp](https://warp.dev) terminal integration for [OpenCode](https://opencode.ai) V2.

## Features

### 🔔 Native Notifications

Get native Warp notifications when OpenCode:
- **Completes a task** — with a summary showing your prompt and the response
- **Needs your input** — when a permission request is pending
- **Runs a tool** — status updates as tools execute

Notifications appear in Warp's notification center and as system notifications.

## Installation

### From npm (recommended)

Add the plugin to your global `~/.config/opencode/cli.json` file:

```json
{
  "plugins": ["@warp-dot-dev/opencode-warp"]
}
```

V2 loads the terminal entrypoint from `./tui`. The CLI reads this file, including when it connects to a remote server.

### From local files

For local development, build the package and add its directory to `~/.config/opencode/cli.json`:

```bash
npm install
npm run build
```

```json
{
  "plugins": ["/absolute/path/to/opencode-warp"]
}
```

Keep the root `tui.js` file beside `package.json`. OpenCode 2.0.32 uses this file to load local CLI plugins.

## Requirements

- [Warp terminal](https://warp.dev) (macOS, Linux, or Windows)
- [OpenCode](https://opencode.ai) V2 CLI

## How It Works

The CLI plugin uses OpenCode V2's attention API for system notifications and sounds. It also sends Warp's [pluggable notifications](https://docs.warp.dev/features/notifications) by using OSC escape sequences.

When OpenCode triggers an event, the plugin:

1. Reads event data from OpenCode's V2 plugin API.
2. Formats a notification payload.
3. Sends an OSC 777 escape sequence to Warp.

The plugin sends status events only for the session displayed in that terminal pane.

The plugin hooks into these OpenCode events:
- **session.created** — confirms the plugin is active
- **session.execution.succeeded** — fires when OpenCode finishes responding, includes your prompt and the response
- **permission.asked** — fires when OpenCode needs tool approval
- **session.inbox.delivered** — fires when a user prompt is submitted
- **session.tool.success** / **session.tool.failed** — fire when a tool call completes

## Configuration

Notifications work without extra settings. To change notification behavior, see [Warp's notification settings](https://docs.warp.dev/features/notifications).

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

Remove `"@warp-dot-dev/opencode-warp"` from the `plugins` array in `~/.config/opencode/cli.json`.

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/warpdotdev/opencode-warp).

## License

MIT License — see [LICENSE](LICENSE) for details.
