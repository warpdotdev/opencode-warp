import path from "path"
import { truncate } from "./utils"

const PLUGIN_MAX_PROTOCOL_VERSION = 1

function negotiateProtocolVersion(): number {
  const warpVersion = parseInt(
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION || "1",
    10,
  )
  if (isNaN(warpVersion)) return PLUGIN_MAX_PROTOCOL_VERSION
  return Math.min(warpVersion, PLUGIN_MAX_PROTOCOL_VERSION)
}

interface PayloadBase {
  v: number
  agent: string
  event: string
  session_id: string
  cwd: string
  project: string
}

function buildPayload(
  event: string,
  sessionId: string,
  cwd: string,
  extraFields: Record<string, unknown> = {},
): string {
  const base: PayloadBase = {
    v: negotiateProtocolVersion(),
    agent: "opencode",
    event,
    session_id: sessionId,
    cwd,
    project: cwd ? path.basename(cwd) : "",
  }
  return JSON.stringify({ ...base, ...extraFields })
}

function buildPermissionPayload(
  sessionId: string,
  cwd: string,
  toolName: string,
  metadata: Record<string, unknown>,
): string {
  let toolInput: { command?: string; file_path?: string } | undefined
  let toolPreview = ""

  if (typeof metadata.command === "string") {
    toolPreview = metadata.command
    toolInput = { command: truncate(metadata.command, 200) }
  } else if (typeof metadata.file_path === "string") {
    toolPreview = metadata.file_path
    toolInput = { file_path: truncate(metadata.file_path, 200) }
  } else if (typeof metadata.filePath === "string") {
    toolPreview = metadata.filePath
    toolInput = { file_path: truncate(metadata.filePath, 200) }
  } else {
    toolPreview = truncate(JSON.stringify(metadata), 80)
  }

  const summary = `Wants to run ${toolName}${toolPreview ? `: ${truncate(toolPreview, 120)}` : ""}`
  return buildPayload("permission_request", sessionId, cwd, {
    summary,
    tool_name: toolName,
    ...(toolInput ? { tool_input: toolInput } : {}),
  })
}

export { buildPayload, buildPermissionPayload, negotiateProtocolVersion, PLUGIN_MAX_PROTOCOL_VERSION }
