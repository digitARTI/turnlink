import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readPrivate } from './storage.js';

// These are the Codex stdio tool definitions explicitly approved for the
// synthetic test. A same-named tool from another harness can have a different
// schema or description and is not automatically covered by that approval.
const authorized = new Map([
  ['channel_join', '9ff1a01b67cf6765d4b17e98c73bc356ec992183e9a4ea78be7e25e14284042b'],
  ['channel_send', 'f192be2dac31cfec7d117c074784f576765838619130d0dddba79a4f8ce97b33'],
  ['channel_history', '7bc91a1d37efd4ad87a58be236132592c38a570a48f8c57a1aa26c68a8abe073'],
  ['channel_status', '4d1d3652a0b6cb64ad8b36f422ca08ca11537601cad582b0f3785c9bf86af9c3'],
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

// A separately approved catalogue is pinned by its exact file hash. The
// caller must obtain the operator's explicit approval before supplying it.
export function readApprovedToolCatalogue(path, sha256) {
  if (typeof path !== 'string' || !isAbsolute(path) || !/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('An approved catalogue file and SHA-256 are required');
  const raw = readPrivate(path, 1024 * 1024);
  if (createHash('sha256').update(raw).digest('hex') !== sha256) throw new Error('Approved tool catalogue hash mismatch');
  const tools = JSON.parse(raw);
  if (!Array.isArray(tools) || !tools.length || tools.some(tool => tool?.type !== 'function' || typeof tool.function?.name !== 'string') ||
      new Set(tools.map(tool => tool.function.name)).size !== tools.length) throw new Error('Invalid approved tool catalogue');
  return tools;
}

export function filterApprovedToolCatalogue(tools, approved) {
  if (!Array.isArray(tools)) throw new Error('Tool catalogue unavailable');
  const selected = [];
  for (const tool of tools) {
    const expected = approved.find(value => value.function.name === tool?.function?.name && tool?.type === 'function');
    if (!expected) continue;
    if (JSON.stringify(canonical(tool)) !== JSON.stringify(canonical(expected))) throw new Error('Approved tool schema changed');
    if (selected.some(value => value.function.name === tool.function.name)) throw new Error('Duplicate approved tool name');
    selected.push(tool);
  }
  if (!selected.length) throw new Error('No approved tools available');
  return selected;
}

// Codex Responses API represents MCP tools inside a namespace instead of the
// Chat Completions function wrapper. Only the exact approved children and
// wrapper description may be forwarded; all other tools are removed.
export function readApprovedCodexControl(path, sha256) {
  if (typeof path !== 'string' || !isAbsolute(path) || !/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('An approved Codex control schema and SHA-256 are required');
  const raw = readPrivate(path, 1024 * 1024);
  if (createHash('sha256').update(raw).digest('hex') !== sha256) throw new Error('Approved Codex control schema hash mismatch');
  const value = JSON.parse(raw);
  if (value?.namespace !== 'mcp__turnlink' || typeof value.description !== 'string' || value.tool?.type !== 'function' || value.tool?.name !== 'channel_control')
    throw new Error('Invalid approved Codex control schema');
  return value;
}

export function filterCodexResponsesTools(tools, approvedControl) {
  if (!Array.isArray(tools)) throw new Error('Tool catalogue unavailable');
  const selected = [], seen = new Set(); let namespaceFound = false;
  for (const tool of tools) {
    if (tool?.type === 'namespace' && tool.name === 'mcp__turnlink') {
      if (namespaceFound || typeof tool.description !== 'string' || !Array.isArray(tool.tools) ||
          createHash('sha256').update(tool.description).digest('hex') !== '2869809b1a65d25550484562a048681fe4b452a02060f415b5005ff08a35692a')
        throw new Error('Codex MCP namespace changed');
      namespaceFound = true;
      const children = [];
      for (const child of tool.tools) {
        if (child?.name === 'channel_control' && approvedControl) {
          if (seen.has(child.name) || approvedControl.description !== tool.description ||
              JSON.stringify(canonical(child)) !== JSON.stringify(canonical(approvedControl.tool))) throw new Error('Approved Codex control schema changed');
          children.push(child); seen.add(child.name); continue;
        }
        if (!authorized.has(child?.name)) continue;
        if (child.type !== 'function' || Object.keys(child).some(key => !['type', 'name', 'description', 'strict', 'parameters'].includes(key)) || seen.has(child.name))
          throw new Error('Invalid approved Codex tool');
        const fn = { name: child.name, description: child.description, parameters: child.parameters,
          ...(child.strict !== undefined ? { strict: child.strict } : {}) };
        assertAuthorizedToolCatalogue([{ type: 'function', function: fn }]);
        children.push(child); seen.add(child.name);
      }
      if (!children.length) throw new Error('No approved Codex MCP tools available');
      selected.push({ type: 'namespace', name: 'mcp__turnlink', description: tool.description, tools: children });
      continue;
    }
  }
  if (!namespaceFound) throw new Error('Approved Codex MCP namespace unavailable');
  if (approvedControl && !seen.has('channel_control')) throw new Error('Approved Codex control schema unavailable');
  return selected;
}

// The user's authorization covers these Turnlink schemas only. A new tool or
// a different catalogue format must fail before the request reaches DeepSeek.
export function assertAuthorizedToolCatalogue(tools) {
  if (!Array.isArray(tools) || !tools.length || tools.some(tool => {
    if (tool?.type !== 'function' || Object.keys(tool).some(key => !['type', 'function'].includes(key))) return true;
    const fn = tool.function;
    if (!fn || Object.keys(fn).some(key => !['name', 'description', 'parameters', 'strict'].includes(key)) ||
        (fn.strict !== undefined && typeof fn.strict !== 'boolean')) return true;
    const expected = authorized.get(fn.name);
    const payload = { name: fn.name, description: fn.description, parameters: fn.parameters };
    return !expected || createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex') !== expected;
  }))
    throw new Error('The live test exposes tool schemas beyond the four currently authorized for DeepSeek');
}
