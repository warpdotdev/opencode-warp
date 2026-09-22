import { warpNotify } from "./notify"
import { NOTIFICATION_TITLE } from "./constants"
import { attachWarp, type V2Context } from "./v2"

// OpenCode 2 CLI plugin entrypoint ("./tui" export). Add the package to
// cli.json "plugins" to load it. OpenCode 1 keeps using ./index.
export default {
  id: "warp",
  setup(context: V2Context) {
    // Only Warp builds that speak the cli-agent protocol set this, so other
    // terminals never see the escape sequences.
    if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return
    return attachWarp(context, (body) => warpNotify(NOTIFICATION_TITLE, body))
  },
}
