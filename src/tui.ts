import { Plugin } from "@opencode/plugin/tui"
import type { OpenCodeEvent, SessionMessageInfo, SessionInfo } from "@opencode/client"

import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate, extractTextFromParts } from "./utils"

const PLUGIN_VERSION = "0.1.7"
const NOTIFICATION_TITLE = "warp://cli-agent"

function extractMessageText(message: SessionMessageInfo): string {
    if (message.type === "user") return message.text
    if (message.type !== "assistant") return ""
    return extractTextFromParts(message.content)
}

function getToolName(messages: SessionMessageInfo[], messageID: string, callID: string): string {
    const assistant = messages.find((message) => message.id === messageID)
    if (!assistant || assistant.type !== "assistant") return callID
    const tool = assistant.content.find((part) => part.type === "tool" && part.id === callID)
    return tool?.type === "tool" ? tool.name : callID
}

export default Plugin.define({
    id: "warp.opencode-warp.tui",
    setup(context) {
        if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

        const cwd = context.location?.directory ?? context.data.location.default().directory

        async function isSubagentSession(sessionID: string): Promise<boolean> {
            try {
                await context.data.session.sync(sessionID)
                const session: SessionInfo | undefined = context.data.session.get(sessionID)
                return Boolean(session?.parentID)
            } catch {
                return false
            }
        }

        async function notify(sessionID: string | undefined, body: string): Promise<void> {
            if (sessionID && await isSubagentSession(sessionID)) return
            warpNotify(NOTIFICATION_TITLE, body)

            const payload = JSON.parse(body) as {
                event?: string
                summary?: string
                query?: string
                response?: string
                tool_name?: string
            }
            const message = payload.event === "stop"
                ? payload.response || "OpenCode finished a task"
                : payload.summary
                    || payload.query
                    || (payload.event === "question_asked" ? "OpenCode needs your input" : "OpenCode needs your attention")
            const sound = payload.event === "question_asked"
                ? "question"
                : payload.event === "permission_request"
                    ? "permission"
                    : payload.event === "stop"
                        ? "done"
                        : undefined

            await context.attention.notify({
                title: "OpenCode",
                message,
                notification: { when: "blurred" },
                sound: sound ? { name: sound, when: "blurred" } : false,
            })
        }

        async function messagesFor(sessionID: string): Promise<SessionMessageInfo[]> {
            return context.client.session.context({ sessionID }).catch(() => [])
        }

        async function handleEvent(event: OpenCodeEvent): Promise<void> {
            if ("sessionID" in event.data) {
                const route = context.ui.router.current()
                if (route.type !== "session" || route.sessionID !== event.data.sessionID) return
            }
            const eventCwd = event.location?.directory ?? cwd
            switch (event.type) {
                case "session.created": {
                    if (event.data.parentID) return
                    await notify(
                        event.data.sessionID,
                        buildPayload("session_start", event.data.sessionID, eventCwd, {
                            plugin_version: PLUGIN_VERSION,
                        }),
                    )
                    return
                }

                case "session.execution.succeeded": {
                    const sessionID = event.data.sessionID
                    const messages = [...await messagesFor(sessionID)].reverse()
                    const user = messages.find((message) => message.type === "user")
                    const assistant = messages.find((message) => message.type === "assistant")
                    await notify(sessionID, buildPayload("stop", sessionID, eventCwd, {
                        query: user ? truncate(extractMessageText(user), 200) : "",
                        response: assistant ? truncate(extractMessageText(assistant), 200) : "",
                        transcript_path: "",
                    }))
                    return
                }

                case "permission.asked": {
                    const { action, metadata = {}, sessionID } = event.data
                    const preview = typeof metadata.command === "string"
                        ? metadata.command
                        : typeof metadata.file_path === "string"
                            ? metadata.file_path
                            : typeof metadata.filePath === "string"
                                ? metadata.filePath
                                : JSON.stringify(metadata).slice(0, 80)
                    const summary = `Wants to run ${action}${preview ? `: ${truncate(preview, 120)}` : ""}`
                    await notify(sessionID, buildPayload("permission_request", sessionID, eventCwd, {
                        summary,
                        tool_name: action,
                        tool_input: metadata,
                    }))
                    return
                }

                case "permission.replied": {
                    if (event.data.reply === "reject") return
                    await notify(event.data.sessionID, buildPayload(
                        "permission_replied",
                        event.data.sessionID,
                        eventCwd,
                    ))
                    return
                }

                case "session.inbox.delivered": {
                    const messages = [...await messagesFor(event.data.sessionID)].reverse()
                    const user = messages.find((message) => message.type === "user")
                    if (!user) return
                    const query = extractMessageText(user)
                    if (!query) return
                    await notify(event.data.sessionID, buildPayload("prompt_submit", event.data.sessionID, eventCwd, {
                        query: truncate(query, 200),
                    }))
                    return
                }

                case "session.tool.called": {
                    const name = getToolName(
                        await messagesFor(event.data.sessionID),
                        event.data.assistantMessageID,
                        event.data.id,
                    )
                    if (name !== "question") return
                    await notify(event.data.sessionID, buildPayload("question_asked", event.data.sessionID, eventCwd, {
                        tool_name: name,
                    }))
                    return
                }

                case "session.tool.success":
                case "session.tool.failed": {
                    const name = getToolName(
                        await messagesFor(event.data.sessionID),
                        event.data.assistantMessageID,
                        event.data.id,
                    )
                    await notify(event.data.sessionID, buildPayload("tool_complete", event.data.sessionID, eventCwd, {
                        tool_name: name,
                    }))
                    return
                }
            }
        }

        const stopListening = context.data.listen(({ details }) => {
            handleEvent(details).catch(logNotificationError)
        })

        return stopListening
    },
})

function logNotificationError(error: unknown): void {
    console.error("[opencode-warp] failed to handle event:", error)
}
