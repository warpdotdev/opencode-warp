import { buildPayload } from "./payload";
import { warpNotify } from "./notify";
const PLUGIN_VERSION = "0.1.0";
const NOTIFICATION_TITLE = "warp://cli-agent";
function truncate(str, maxLen) {
    if (str.length <= maxLen)
        return str;
    return str.slice(0, maxLen - 3) + "...";
}
function extractTextFromParts(parts) {
    return parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ");
}
export const WarpPlugin = async ({ client, directory }) => {
    await client.app.log({
        body: {
            service: "opencode-warp",
            level: "info",
            message: "Warp plugin initialized",
        },
    });
    return {
        event: async ({ event }) => {
            const cwd = directory || "";
            if (event.type === "session.created") {
                const ev = event;
                const sessionId = ev.properties.info.id;
                const body = buildPayload("session_start", sessionId, cwd, {
                    plugin_version: PLUGIN_VERSION,
                });
                warpNotify(NOTIFICATION_TITLE, body);
                return;
            }
            if (event.type === "session.idle") {
                const ev = event;
                const sessionId = ev.properties.sessionID;
                // Fetch the conversation to extract last query and response
                // (port of on-stop.sh transcript parsing)
                let query = "";
                let response = "";
                if (sessionId) {
                    try {
                        const result = await client.session.messages({
                            path: { id: sessionId },
                        });
                        const messages = result.data;
                        if (messages) {
                            const lastUser = [...messages]
                                .reverse()
                                .find((m) => m.info.role === "user");
                            if (lastUser) {
                                query = extractTextFromParts(lastUser.parts);
                            }
                            const lastAssistant = [...messages]
                                .reverse()
                                .find((m) => m.info.role === "assistant");
                            if (lastAssistant) {
                                response = extractTextFromParts(lastAssistant.parts);
                            }
                        }
                    }
                    catch {
                        // If we can't fetch messages, send the notification without query/response
                    }
                }
                const body = buildPayload("stop", sessionId, cwd, {
                    query: truncate(query, 200),
                    response: truncate(response, 200),
                    transcript_path: "",
                });
                warpNotify(NOTIFICATION_TITLE, body);
                return;
            }
            if (event.type === "message.updated") {
                const ev = event;
                const message = ev.properties.info;
                if (message.role !== "user")
                    return;
                const sessionId = message.sessionID;
                // message.updated doesn't carry parts directly — fetch the message
                let queryText = "";
                try {
                    const result = await client.session.message({
                        path: { id: sessionId, messageID: message.id },
                    });
                    const data = result.data;
                    if (data) {
                        queryText = extractTextFromParts(data.parts);
                    }
                }
                catch {
                    // Fall back to using summary title if available
                    queryText = message.summary?.title ?? "";
                }
                if (!queryText)
                    return;
                const body = buildPayload("prompt_submit", sessionId, cwd, {
                    query: truncate(queryText, 200),
                });
                warpNotify(NOTIFICATION_TITLE, body);
                return;
            }
        },
        // Permission requests — fires when OpenCode asks for tool approval
        "permission.ask": async (input) => {
            const sessionId = input.sessionID;
            const toolName = input.type || "unknown";
            const metadata = input.metadata || {};
            const cwd = directory || "";
            // Build human-readable summary (same logic as on-permission-request.sh)
            let toolPreview = "";
            if (typeof metadata.command === "string") {
                toolPreview = metadata.command;
            }
            else if (typeof metadata.file_path === "string") {
                toolPreview = metadata.file_path;
            }
            else if (typeof metadata.filePath === "string") {
                toolPreview = metadata.filePath;
            }
            else {
                const raw = JSON.stringify(metadata);
                toolPreview = raw.slice(0, 80);
            }
            let summary = `Wants to run ${toolName}`;
            if (toolPreview) {
                summary += `: ${truncate(toolPreview, 120)}`;
            }
            const body = buildPayload("permission_request", sessionId, cwd, {
                summary,
                tool_name: toolName,
                tool_input: metadata,
            });
            warpNotify(NOTIFICATION_TITLE, body);
        },
        // Tool completion — fires after every tool call
        "tool.execute.after": async (input) => {
            const toolName = input.tool;
            const sessionId = input.sessionID;
            const cwd = directory || "";
            const body = buildPayload("tool_complete", sessionId, cwd, {
                tool_name: toolName,
            });
            warpNotify(NOTIFICATION_TITLE, body);
        },
    };
};
//# sourceMappingURL=index.js.map