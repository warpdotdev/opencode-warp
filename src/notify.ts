import { writeFileSync, openSync, writeSync, closeSync } from "fs"

/**
 * Write data directly to the controlling terminal, bypassing any
 * stdio redirection that the plugin host (OpenCode) may have set up.
 *
 * Tries platform-appropriate TTY devices in order:
 *   Unix  → /dev/tty
 *   Win32 → CONOUT$, CON
 *
 * Falls back to process.stderr (less commonly redirected than stdout).
 * Returns true on first successful write.
 */
function writeTty(data: string): boolean {
  const devices =
    process.platform === "win32"
      ? ["/dev/tty", "CONOUT$", "CON"]
      : ["/dev/tty"]

  for (const device of devices) {
    try {
      const fd = openSync(device, "w")
      try {
        writeSync(fd, data)
        return true
      } finally {
        closeSync(fd)
      }
    } catch {
      // Device not available on this platform — try next
    }
  }

  // Last resort: stderr is often still connected to the terminal
  // even when stdout is piped for plugin RPC.
  if (process.stderr?.isTTY) {
    try {
      process.stderr.write(data)
      return true
    } catch {
      // ignore
    }
  }

  return false
}

/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when Warp declares cli-agent protocol support,
 * avoiding garbled output in other terminals (and working over SSH).
 */
function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

  // Guard against known-broken Warp builds that set the protocol
  // env var but cannot actually render structured notifications.
  // Mirrors the check in claude-code-warp's should-use-structured.sh.
  if (!process.env.WARP_CLIENT_VERSION) return

  const LAST_BROKEN_STABLE = "v0.2026.03.25.08.24.stable_05"
  const LAST_BROKEN_PREVIEW = "v0.2026.03.25.08.24.preview_05"
  const ver = process.env.WARP_CLIENT_VERSION
  if (ver.includes("stable") && ver <= LAST_BROKEN_STABLE) return
  if (ver.includes("preview") && ver <= LAST_BROKEN_PREVIEW) return

  // OSC 777 format: \033]777;notify;<title>;<body>\007
  const sequence = `\x1b]777;notify;${title};${body}\x07`
  writeTty(sequence)
}

export { warpNotify, writeTty }
