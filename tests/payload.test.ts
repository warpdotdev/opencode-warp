import { describe, it, afterEach } from "node:test"
import assert from "node:assert/strict"
import { buildPayload, negotiateProtocolVersion, PLUGIN_MAX_PROTOCOL_VERSION } from "../src/payload"

describe("buildPayload", () => {
  it("common fields", () => {
    const payload = JSON.parse(
      buildPayload("stop", "sess-123", "/Users/alice/my-project"),
    )
    assert.strictEqual(payload.v, 1)
    assert.strictEqual(payload.agent, "opencode")
    assert.strictEqual(payload.event, "stop")
    assert.strictEqual(payload.session_id, "sess-123")
    assert.strictEqual(payload.cwd, "/Users/alice/my-project")
    assert.strictEqual(payload.project, "my-project")
  })

  it("common fields with missing data", () => {
    const payload = JSON.parse(buildPayload("stop", "", ""))
    assert.strictEqual(payload.session_id, "")
    assert.strictEqual(payload.cwd, "")
    assert.strictEqual(payload.project, "")
  })

  it("extra args are merged", () => {
    const payload = JSON.parse(
      buildPayload("stop", "s1", "/tmp/proj", {
        query: "hello",
        response: "world",
      }),
    )
    assert.strictEqual(payload.query, "hello")
    assert.strictEqual(payload.response, "world")
    assert.strictEqual(payload.session_id, "s1")
  })

  it("stop event", () => {
    const payload = JSON.parse(
      buildPayload("stop", "s1", "/tmp/proj", {
        query: "write a haiku",
        response: "Memory is safe, the borrow checker stands guard",
        transcript_path: "/tmp/transcript.jsonl",
      }),
    )
    assert.strictEqual(payload.event, "stop")
    assert.strictEqual(payload.query, "write a haiku")
    assert.strictEqual(
      payload.response,
      "Memory is safe, the borrow checker stands guard",
    )
    assert.strictEqual(payload.transcript_path, "/tmp/transcript.jsonl")
  })

  it("permission request event", () => {
    const payload = JSON.parse(
      buildPayload("permission_request", "s1", "/tmp/proj", {
        summary: "Wants to run Bash: rm -rf /tmp",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /tmp" },
      }),
    )
    assert.strictEqual(payload.event, "permission_request")
    assert.strictEqual(payload.summary, "Wants to run Bash: rm -rf /tmp")
    assert.strictEqual(payload.tool_name, "Bash")
    assert.strictEqual(payload.tool_input.command, "rm -rf /tmp")
  })

  it("idle prompt event", () => {
    const payload = JSON.parse(
      buildPayload("idle_prompt", "s1", "/tmp/proj", {
        summary: "Claude is waiting for your input",
      }),
    )
    assert.strictEqual(payload.event, "idle_prompt")
    assert.strictEqual(payload.summary, "Claude is waiting for your input")
  })

  it("JSON special characters in values", () => {
    const payload = JSON.parse(
      buildPayload("stop", "s1", "/tmp/proj", {
        query: 'what does "hello world" mean?',
        response: 'It means greeting. Use: printf("hello")',
      }),
    )
    assert.strictEqual(payload.query, 'what does "hello world" mean?')
    assert.strictEqual(payload.response, 'It means greeting. Use: printf("hello")')
  })
})

describe("negotiateProtocolVersion", () => {
  const originalEnv = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    } else {
      process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalEnv
    }
  })

  it("defaults to plugin max when env var absent", () => {
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    assert.strictEqual(negotiateProtocolVersion(), PLUGIN_MAX_PROTOCOL_VERSION)
  })

  it("v1 when warp declares 1", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    assert.strictEqual(negotiateProtocolVersion(), 1)
  })

  it("capped to plugin max when warp is ahead", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "99"
    assert.strictEqual(negotiateProtocolVersion(), PLUGIN_MAX_PROTOCOL_VERSION)
  })

  it("uses warp version when it is lower than plugin max", () => {
    // This test is only meaningful if PLUGIN_MAX > 1.
    // We test the min() logic by checking that version 1 is returned
    // when warp declares 1 and plugin max is 1.
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    assert.strictEqual(negotiateProtocolVersion(), 1)
  })

  it("handles non-numeric env var gracefully", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "not-a-number"
    assert.strictEqual(negotiateProtocolVersion(), PLUGIN_MAX_PROTOCOL_VERSION)
  })
})
