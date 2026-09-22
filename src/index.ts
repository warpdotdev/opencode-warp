import type { Plugin } from "@opencode-ai/plugin"
import type { Event, Permission } from "@opencode-ai/sdk"

import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate, extractTextFromParts } from "./utils"
import { PLUGIN_VERSION, NOTIFICATION_TITLE } from "./constants"

// NOTE: do not re-export these constants — opencode's legacy plugin loader
// treats every named export as a plugin function and throws if any export
// is not a function ("Plugin export is not a function").

function buildPermissionPayload(perm: Permission, cwd: string) {
    const toolName = perm.type || "unknown"
    const metadata = perm.metadata || {}

    let toolPreview = ""
    if (typeof metadata.command === "string") {
        toolPreview = metadata.command
    } else if (typeof metadata.file_path === "string") {
        toolPreview = metadata.file_path as string
    } else if (typeof metadata.filePath === "string") {
        toolPreview = metadata.filePath as string
    } else {
        const raw = JSON.stringify(metadata)
        toolPreview = raw.slice(0, 80)
    }

    let summary = `Wants to run ${toolName}`
    if (toolPreview) {
        summary += `: ${truncate(toolPreview, 120)}`
    }

    return buildPayload("permission_request", perm.sessionID, cwd, {
        summary,
        tool_name: toolName,
        tool_input: metadata,
    })
}

export const WarpPlugin: Plugin = async ({ client, directory }) => {
    // Fire-and-forget the init log: awaiting client.app.log here can deadlock
    // opencode's plugin loader on some versions (e.g. 1.4.8).
    if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
        client.app
            .log({
                body: {
                    service: "opencode-warp",
                    level: "warn",
                    message:
                        "⚠️ Detected unsupported Warp version. Please update Warp to use this plugin.",
                },
            })
            .catch((err) => {
                console.error("[opencode-warp] failed to emit init log:", err)
            })
        return {}
    }

    client.app
        .log({
            body: {
                service: "opencode-warp",
                level: "info",
                message: "Warp plugin initialized",
            },
        })
        .catch((err) => {
            console.error("[opencode-warp] failed to emit init log:", err)
        })

    const subagentCache = new Map<string, boolean>()

    async function isSubagentSession(sessionId?: string): Promise<boolean> {
        if (!sessionId) return false
        if (subagentCache.has(sessionId)) return subagentCache.get(sessionId)!
        try {
            const session = await client.session.get({
                path: { id: sessionId },
            })
            const result = !!session.data?.parentID
            subagentCache.set(sessionId, result)
            return result
        } catch {
            // If we can't fetch the session, fall through and notify anyway
            return false
        }
    }

    async function maybeWarpNotify(sessionId: string | undefined, body: string): Promise<void> {
        if (await isSubagentSession(sessionId)) return
        warpNotify(NOTIFICATION_TITLE, body)
    }

    return {
        event: async ({ event }: { event: Event }) => {
            const cwd = directory || ""

            switch (event.type) {
                case "session.created": {
                    const info = event.properties.info
                    if (info.parentID) return
                    const body = buildPayload("session_start", info.id, cwd, {
                        plugin_version: PLUGIN_VERSION,
                    })
                    await maybeWarpNotify(info.id, body)
                    return
                }

                case "session.idle": {
                    const sessionId = event.properties.sessionID

                    // Fetch the conversation to extract last query and response
                    // (port of on-stop.sh transcript parsing)
                    let query = ""
                    let response = ""

                    if (sessionId) {
                        try {
                            const result = await client.session.messages({
                                path: { id: sessionId },
                            })
                            const messages = result.data

                            if (messages) {
                                const reversed = [...messages].reverse()

                                const lastUser = reversed.find(
                                    (m) => m.info.role === "user",
                                )
                                if (lastUser) {
                                    query = extractTextFromParts(lastUser.parts)
                                }

                                const lastAssistant = reversed.find(
                                    (m) => m.info.role === "assistant",
                                )
                                if (lastAssistant) {
                                    response = extractTextFromParts(lastAssistant.parts)
                                }
                            }
                        } catch {
                            // If we can't fetch messages, send the notification without query/response
                        }
                    }

                    const body = buildPayload("stop", sessionId, cwd, {
                        query: truncate(query, 200),
                        response: truncate(response, 200),
                        transcript_path: "",
                    })
                    await maybeWarpNotify(sessionId, body)
                    return
                }

                case "permission.updated": {
                    await maybeWarpNotify(
                        event.properties.sessionID,
                        buildPermissionPayload(event.properties, cwd),
                    )
                    return
                }

                case "permission.replied": {
                    const { sessionID, response } = event.properties
                    if (response === "reject") return
                    const body = buildPayload("permission_replied", sessionID, cwd)
                    await maybeWarpNotify(sessionID, body)
                    return
                }

                default: {
                    // permission.asked is listed in the opencode docs but has no SDK type.
                    // Handle it with the same logic as permission.updated.
                    if ((event as any).type === "permission.asked") {
                        await maybeWarpNotify(
                            (event as any).properties?.sessionID,
                            buildPermissionPayload((event as any).properties, cwd),
                        )
                    }
                }
            }
        },

        // Fires once per new user message — used to send the prompt_submit hook.
        // (We avoid the generic message.updated event because OpenCode fires it
        // multiple times per message, and a late duplicate can clobber the
        // completion notification.)
        "chat.message": async (input, output) => {
            const cwd = directory || ""

            const queryText = extractTextFromParts(output.parts)
            if (!queryText) return

            const body = buildPayload("prompt_submit", input.sessionID, cwd, {
                query: truncate(queryText, 200),
            })
            await maybeWarpNotify(input.sessionID, body)
        },

        // Fires before a tool executes — used to detect the built-in
        // "question" tool so Warp can notify the user that input is needed.
        "tool.execute.before": async (input) => {
            if (input.tool !== "question") return

            const cwd = directory || ""
            const body = buildPayload("question_asked", input.sessionID, cwd, {
                tool_name: input.tool,
            })
            await maybeWarpNotify(input.sessionID, body)
        },

        // Tool completion — fires after every tool call
        "tool.execute.after": async (input) => {
            const toolName = input.tool
            const sessionId = input.sessionID
            const cwd = directory || ""

            const body = buildPayload("tool_complete", sessionId, cwd, {
                tool_name: toolName,
            })
            await maybeWarpNotify(sessionId, body)
        },
    }
}
