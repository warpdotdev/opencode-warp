import { readlinkSync, writeFileSync } from "fs"

/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when Warp declares cli-agent protocol support,
 * avoiding garbled output in other terminals (and working over SSH).
 *
 * In the CLI plugin, stdin identifies the Warp pane that hosts OpenCode.
 * Write to that TTY so Warp can update the matching pane's status.
 */
function resolveWarpTTY(
  configuredTTY: string | undefined,
  stdinIsTTY: boolean,
  stdinFD: number | undefined,
  ttyname: (fd: number) => string | undefined,
): string | undefined {
  if (configuredTTY) return configuredTTY
  if (!stdinIsTTY || stdinFD === undefined) return undefined

  try {
    return ttyname(stdinFD)
  } catch {
    return undefined
  }
}

function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

  const sequence = `\x1b]777;notify;${title};${body}\x07`
  const tty = resolveWarpTTY(
    process.env.WARP_CLI_AGENT_TTY,
    process.stdin.isTTY === true,
    process.stdin.isTTY === true ? process.stdin.fd : undefined,
    (fd) => {
      try {
        return readlinkSync(`/dev/fd/${fd}`)
      } catch {
        return undefined
      }
    },
  )

  if (tty) {
    try {
      writeFileSync(tty, sequence)
      return
    } catch (error) {
      console.error("[opencode-warp] failed to write Warp notification to pane TTY:", error)
      return
    }
  }

  try {
    // Standalone CLI use can use /dev/tty or stdout if no TTY path is known.
    writeFileSync("/dev/tty", sequence)
  } catch {
    try {
      process.stdout.write(sequence)
    } catch {
      // Silently ignore if stdout is unavailable.
    }
  }
}

export { resolveWarpTTY, warpNotify }
