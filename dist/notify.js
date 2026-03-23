import { writeFileSync } from "fs";
/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when running inside Warp terminal to avoid garbled output in other terminals.
 */
function warpNotify(title, body) {
    if (process.env.TERM_PROGRAM !== "WarpTerminal")
        return;
    try {
        // OSC 777 format: \033]777;notify;<title>;<body>\007
        const sequence = `\x1b]777;notify;${title};${body}\x07`;
        writeFileSync("/dev/tty", sequence);
    }
    catch {
        // Silently ignore if /dev/tty is not available
    }
}
export { warpNotify };
//# sourceMappingURL=notify.js.map