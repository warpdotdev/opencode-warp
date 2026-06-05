import { writeFileSync } from "fs"

/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when Warp declares cli-agent protocol support and the current
 * terminal does not explicitly identify itself as another terminal.
 *
 * On Unix we write to /dev/tty so the sequence bypasses any
 * stdout redirection or terminal-multiplexer capture.
 * On Windows /dev/tty doesn't exist, so we fall back to
 * process.stdout which works because OpenCode plugins run
 * in-process (sharing the same ConPTY-connected stdout).
 */
function warpNotify(title: string, body: string): void {
  if (!supportsWarpCliAgentProtocol()) return

  const sequence = `\x1b]777;notify;${title};${body}\x07`

  try {
    writeFileSync("/dev/tty", sequence)
  } catch {
    // /dev/tty unavailable (e.g. Windows) — write to stdout instead.
    try {
      process.stdout.write(sequence)
    } catch {
      // Silently ignore if stdout is also unavailable
    }
  }
}

function supportsWarpCliAgentProtocol(): boolean {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return false

  // Warp's variables can leak into GUI apps launched from Warp. Keep allowing
  // SSH sessions where TERM_PROGRAM is unset, but never write Warp OSC into a
  // terminal that explicitly identifies itself as something else.
  return !process.env.TERM_PROGRAM || process.env.TERM_PROGRAM === "WarpTerminal"
}

export { warpNotify, supportsWarpCliAgentProtocol }
