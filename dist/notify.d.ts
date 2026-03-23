/**
 * Send a Warp notification via OSC 777 escape sequence.
 * Only emits when running inside Warp terminal to avoid garbled output in other terminals.
 */
declare function warpNotify(title: string, body: string): void;
export { warpNotify };
//# sourceMappingURL=notify.d.ts.map