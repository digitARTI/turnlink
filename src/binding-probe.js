// Diagnostic MCP server: no broker access, credentials, environment dump or writes.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const safeId = value => typeof value === 'string' && (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) || /^ses_[A-Za-z0-9_-]{8,160}$/.test(value)) ? value : null;
const mcp = new Server({ name: 'turnlink-binding-probe', version: '0.2.0' }, { capabilities: { tools: {} },
  instructions: 'Read-only diagnostic: report actual process session binding and safe outer MCP metadata candidates. This does not grant or claim identity.' });
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'turnlink_binding_probe',
  description: 'Inspect only the actual MCP process session ID and safe outer request metadata. No credentials or environment values are dumped.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }] }));
mcp.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'turnlink_binding_probe' || Object.keys(request.params.arguments || {}).length) throw new Error('Probe takes no arguments');
  const meta = request.params._meta || {};
  const candidates = {};
  for (const key of ['threadId', 'thread_id', 'sessionId', 'session_id', 'codex/thread-id', 'openai/thread-id']) {
    if (safeId(meta[key])) candidates[key] = safeId(meta[key]);
  }
  const data = {
    codexThreadIdPresent: !!process.env.CODEX_THREAD_ID,
    codexThreadId: safeId(process.env.CODEX_THREAD_ID),
    explicitSessionIdPresent: !!process.env.AGENT_CHANNEL_SESSION_ID,
    explicitSessionId: safeId(process.env.AGENT_CHANNEL_SESSION_ID),
    outerMetadataKeys: Object.keys(meta).slice(0, 32).map(key => /^[A-Za-z0-9./_-]{1,80}$/.test(key) && !/^[a-f0-9]{32,}$/i.test(key) ? key : '(opaque key)'),
    validatedIdCandidates: candidates,
    note: 'Candidate metadata is diagnostic only; no authority is inferred from tool arguments or model claims.',
  };
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
});
await mcp.connect(new StdioServerTransport());
