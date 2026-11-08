const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Opt-in for an MCP server launched by Codex over its private stdio transport.
// Only OUTER framework metadata is considered; tool arguments never bind identity.
export function codexStdioSession(meta, environmentBinding) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) ||
      !Object.hasOwn(meta, 'x-codex-turn-metadata') ||
      !Object.hasOwn(meta, 'threadId') || !Object.hasOwn(meta, 'sessionId') ||
      typeof meta.threadId !== 'string' || typeof meta.sessionId !== 'string' ||
      !uuid.test(meta.threadId) || !uuid.test(meta.sessionId) ||
      meta.threadId.toLowerCase() !== meta.sessionId.toLowerCase()) {
    throw new Error('Trusted Codex stdio thread/session metadata is missing or inconsistent');
  }
  const id = meta.threadId.toLowerCase();
  if (environmentBinding && environmentBinding.toLowerCase() !== id) throw new Error('Harness environment and outer metadata disagree');
  return id;
}
