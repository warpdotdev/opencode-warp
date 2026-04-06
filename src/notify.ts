import { writeFileSync } from "fs"

/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when Warp declares cli-agent protocol support,
 * avoiding garbled output in other terminals (and working over SSH).
 */
function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

  try {
    // OSC 777 format: \033]777;notify;<title>;<body>\007
    const sequence = `\x1b]777;notify;${title};${body}\x07`
    writeFileSync("/dev/tty", sequence)
  } catch {
    // Silently ignore if /dev/tty is not available
  }
}

export { warpNotify }
