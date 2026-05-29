import { writeFileSync } from "fs"

/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when Warp declares cli-agent protocol support,
 * avoiding garbled output in other terminals (and working over SSH).
 *
 * On Unix we write to /dev/tty so the sequence bypasses any
 * stdout redirection or terminal-multiplexer capture.
 * On Windows /dev/tty doesn't exist, so we fall back to
 * process.stdout which works because OpenCode plugins run
 * in-process (sharing the same ConPTY-connected stdout).
 */
function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

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

export { warpNotify }
