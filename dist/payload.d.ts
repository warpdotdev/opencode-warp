declare const PLUGIN_MAX_PROTOCOL_VERSION = 1;
declare function negotiateProtocolVersion(): number;
declare function buildPayload(event: string, sessionId: string, cwd: string, extraFields?: Record<string, unknown>): string;
export { buildPayload, negotiateProtocolVersion, PLUGIN_MAX_PROTOCOL_VERSION };
//# sourceMappingURL=payload.d.ts.map