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
  "plugin": ["@warp-dot-dev/opencode-warp"]
}
```

### From local files

Copy or symlink the built plugin into your OpenCode plugins directory:

```bash
# Global
cp dist/index.js ~/.config/opencode/plugins/opencode-warp.js

# Or project-level
cp dist/index.js .opencode/plugins/opencode-warp.js
```

## Requirements

- [Warp terminal](https://warp.dev) (macOS, Linux, or Windows)
- [OpenCode](https://opencode.ai) CLI

## How It Works

This plugin uses Warp's [pluggable notifications](https://docs.warp.dev/features/notifications) feature via OSC escape sequences. When OpenCode triggers an event, the plugin:

1. Reads event data from OpenCode's plugin API
2. Formats a concise notification payload
3. Sends an OSC 777 escape sequence to Warp, which displays a native notification

The plugin hooks into these OpenCode events:
- **session.created** — confirms the plugin is active
- **session.idle** — fires when OpenCode finishes responding, includes your prompt and the response
- **permission.updated** / **permission.asked** — fires when OpenCode needs tool approval
- **message.updated** — fires when a user prompt is submitted
- **tool.execute.after** — fires when a tool call completes

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

Remove `"@warp-dot-dev/opencode-warp"` from the `plugin` array in your `opencode.json`.

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/warpdotdev/opencode-warp).

## License

MIT License — see [LICENSE](LICENSE) for details.
