import path from "path";
const PLUGIN_MAX_PROTOCOL_VERSION = 1;
function negotiateProtocolVersion() {
    const warpVersion = parseInt(process.env.WARP_CLI_AGENT_PROTOCOL_VERSION || "1", 10);
    if (isNaN(warpVersion))
        return PLUGIN_MAX_PROTOCOL_VERSION;
    return Math.min(warpVersion, PLUGIN_MAX_PROTOCOL_VERSION);
}
function buildPayload(event, sessionId, cwd, extraFields = {}) {
    const base = {
        v: negotiateProtocolVersion(),
        agent: "opencode",
        event,
        session_id: sessionId,
        cwd,
        project: cwd ? path.basename(cwd) : "",
    };
    return JSON.stringify({ ...base, ...extraFields });
}
export { buildPayload, negotiateProtocolVersion, PLUGIN_MAX_PROTOCOL_VERSION };
//# sourceMappingURL=payload.js.map