import { z } from 'zod';

const observation = z.string().max(1000).refine(value => value.trim().length > 0 && !/^(unknown|unverified|n\/?a)$/i.test(value.trim())).nullable();
const runtimeObservation = z.string().max(128).regex(/^[a-z][a-z0-9 ._-]{0,40} v?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$/i).nullable();
const runtimeProducts = new Map([
  ['opencode', /^opencode v?\d/i],
  ['codex', /^codex(?:[ -](?:cli|desktop|app[ -]server))? v?\d/i],
  ['claude', /^claude(?:[ -]code)? v?\d/i],
]);
function canonicalRuntime(value) {
  const match = /^([a-z][a-z0-9 ._-]{0,40}) v?(\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?)$/i.exec(value);
  return match ? `${match[1].toLowerCase()} ${match[2]}` : null;
}
export const sessionRecord = z.strictObject({ type: z.literal('turnlink.session_record.v2'), taskID: z.string().uuid(), previewID: z.string().uuid(),
  session: z.string(), source: z.string(), destination: z.string(), runtime: runtimeObservation, model: observation, provider: observation, permissions: observation, work: observation })
  .refine(value => value.runtime === null || !!runtimeProducts.get(value.session.split(':', 1)[0])?.test(value.runtime),
    { message: 'Runtime product does not match the session harness', path: ['runtime'] });
export const completeSessionRecord = record => ['runtime', 'model', 'provider', 'permissions', 'work'].every(field => record[field] !== null);
const sessionReport = z.strictObject({ type: z.literal('turnlink.session_report.v2'), taskID: z.string().uuid(), previewID: z.string().uuid(),
  session: z.string(), recordID: z.string().uuid(), requestID: z.string().uuid(), runtime: runtimeObservation, checks: z.strictObject(Object.fromEntries(
    ['session', 'destination', 'runtime', 'model', 'provider', 'permissions', 'work'].map(key => [key, z.enum(['match', 'different', 'unknown'])]))) });
export const parseSessionJSON = text => { try { return JSON.parse(text); } catch { return undefined; } };
export function isSessionRecordMessage(text, taskID, previewID) {
  const value = parseSessionJSON(text);
  return ['turnlink.session_record.v1', 'turnlink.session_record.v2'].includes(value?.type) && value.taskID === taskID && value.previewID === previewID ||
    typeof text === 'string' && /turnlink\.session_record\.v[12]/.test(text) && text.includes(taskID) && text.includes(previewID);
}

// Messages are newest first and must already be scoped to this channel. This
// evaluates agent statements only; it is not native placement evidence.
export function sessionEvidenceStatus(messages, { task, preview, owner }) {
  const own = m => m.from?.agentId === owner && m.to === task.claimant;
  const worker = m => m.from?.agentId === task.claimant && m.to === owner;
  const requestIndex = messages.findIndex(m => own(m) && m.text?.startsWith('Turnlink requests a session comparison after a manual move. ') &&
    m.text.includes(`Task ${task.id}, approved preview ${preview.id}, session ${task.claimant},`));
  if (requestIndex < 0) return { status: 'awaiting_request', agentReported: true };
  const recordIndex = messages.findIndex(m => {
    if (!worker(m)) return false;
    return isSessionRecordMessage(m.text, task.id, preview.id);
  });
  if (recordIndex < 0) return { status: 'awaiting_record', agentReported: true };
  const parsedRecord = sessionRecord.safeParse(parseSessionJSON(messages[recordIndex].text));
  if (!parsedRecord.success || parsedRecord.data.session !== task.claimant || parsedRecord.data.source !== preview.from || parsedRecord.data.destination !== preview.to)
    return { status: 'invalid_record', agentReported: true };
  if (recordIndex <= requestIndex) return { status: 'awaiting_record', agentReported: true };
  const reportMessage = messages.slice(0, requestIndex).find(worker);
  if (!reportMessage) return { status: 'awaiting_report', agentReported: true };
  const parsed = sessionReport.safeParse(parseSessionJSON(reportMessage.text));
  if (!parsed.success || parsed.data.taskID !== task.id || parsed.data.previewID !== preview.id || parsed.data.session !== task.claimant)
    return { status: 'invalid_report', agentReported: true };
  const report = parsed.data;
  if (report.requestID !== messages[requestIndex].id || report.recordID !== messages[recordIndex].id) return { status: 'invalid_report', agentReported: true };
  const record = parsedRecord.data;
  const runtime = { source: record.runtime, destination: report.runtime };
  if (report.checks.runtime === 'match' && (report.runtime === null || record.runtime === null || canonicalRuntime(report.runtime) !== canonicalRuntime(record.runtime)))
    return { status: 'invalid_report', reason: 'runtime_values_do_not_match', agentReported: true, runtime };
  if (report.runtime === null && report.checks.runtime !== 'unknown') return { status: 'invalid_report', agentReported: true };
  for (const field of ['runtime', 'model', 'provider', 'permissions', 'work']) if (record[field] === null && report.checks[field] === 'match')
    return { status: 'invalid_report', agentReported: true };
  const checks = Object.values(report.checks);
  return { status: checks.includes('different') ? 'differences' : checks.includes('unknown') ? 'incomplete' : 'reported_match',
    agentReported: true, checks: report.checks, runtime, recordID: report.recordID, requestID: report.requestID };
}
