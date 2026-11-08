import { AlertSnapshot } from '../src/control/alert-contracts.js';
import { TurnlinkAlerts } from './opencode-alerts-rpc.js';

const scopeKey = scope => JSON.stringify([scope.location.directory, scope.location.workspaceID ?? null, scope.sessionID]);
const lines = snapshot => {
  if (!snapshot.available) return ['Alert status unavailable. No recovery or native admission was attempted.'];
  if (!snapshot.registered) return ['This session has no active Turnlink membership.'];
  const s = snapshot.summary, output = [];
  if (!s.controlAvailable) output.push('Control scheduling is unavailable.');
  if (s.pressure.level !== 'ok') output.push(`Storage pressure: ${s.pressure.level}. Inspect the operator console.`);
  if (s.incidents.open) output.push(`Open channel incidents: ${s.incidents.open}.`);
  if (s.tasks.uncertain) output.push(`Your uncertain tasks: ${s.tasks.uncertain}. Do not blindly retry.`);
  if (s.tasks.overdue) output.push(`Your overdue or stalled tasks: ${s.tasks.overdue}.`);
  if (s.tasks.awaitingReview) output.push(`Your tasks awaiting master review: ${s.tasks.awaitingReview}.`);
  if (s.tasks.reviewForYou) output.push(`Tasks awaiting your master review: ${s.tasks.reviewForYou}. Inspect evidence before acceptance.`);
  if (s.role.proposalForYou) output.push('A master proposal awaits your explicit acceptance. Existing permissions are unchanged.');
  return output;
};

// No broker credentials, file reads, model prompts, actor commands, permission
// replies, automatic navigation or native execution APIs belong in this module.
export function makeOpenCodeAlertsUI(ctx, { now = Date.now, intervalMs = 2000 } = {}) {
  const controller = new AbortController(), remote = ctx.client.rpc(TurnlinkAlerts);
  const [memory, update] = ctx.storage.memory('turnlink.alerts.seen', { initial: { seen: {} } });
  let closed = false, busy = false, lastScope, lastPoll = 0;
  const current = () => {
    const route = ctx.ui.router.current(); if (route.type !== 'session') return;
    const location = ctx.location ?? ctx.data.location.default(), session = ctx.data.session.get(route.sessionID);
    if (!session || session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID) return;
    return { sessionID: route.sessionID, location: { directory: location.directory,
      ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }) } };
  };
  const valid = scope => { const latest = current(); return !closed && !!latest && scopeKey(latest) === scopeKey(scope); };
  const poll = async (manual = false) => {
    if (closed || busy) return;
    const scope = current();
    if (!scope) {
      if (manual) await ctx.ui.dialog.alert({ title: 'Turnlink alerts', message: 'Open a session in this Location to inspect its passive alerts.' });
      return;
    }
    const key = scopeKey(scope), time = now();
    if (!manual && lastScope === key && time >= lastPoll && time - lastPoll < 15000) return;
    lastScope = key; lastPoll = time; busy = true;
    try {
      let snapshot;
      try {
        snapshot = AlertSnapshot.parse(await remote.snapshot({ sessionID: scope.sessionID }, { location: scope.location, signal: controller.signal }));
        if (snapshot.sessionID !== scope.sessionID || (snapshot.summary && snapshot.summary.agentId !== `opencode:${scope.sessionID}`)) throw new Error('ALERT_SCOPE_MISMATCH');
      } catch {
        snapshot = { version: 1, sessionID: scope.sessionID, checkedAt: time, available: false, registered: false };
      }
      if (!valid(scope)) return;
      const messages = lines(snapshot), text = messages.length ? messages.join('\n') : 'No current Turnlink alerts for this session.';
      if (manual) { await ctx.ui.dialog.alert({ title: 'Turnlink alerts', message: text }); return; }
      const signature = JSON.stringify({ registered: snapshot.registered, available: snapshot.available, summary: snapshot.summary && {
        controlAvailable: snapshot.summary.controlAvailable, pressure: snapshot.summary.pressure, incidents: snapshot.summary.incidents,
        tasks: snapshot.summary.tasks, role: snapshot.summary.role,
      } });
      if (memory.seen[key]?.signature === signature) return;
      if (messages.length && (snapshot.registered || !snapshot.available)) {
        const critical = !snapshot.available || !snapshot.summary.controlAvailable || ['critical', 'unavailable'].includes(snapshot.summary.pressure.level) || snapshot.summary.tasks.uncertain > 0;
        ctx.ui.toast.show({ title: 'Turnlink', message: text, variant: critical ? 'error' : 'warning', duration: 8000 });
        if (ctx.options.alertNotifications === true && valid(scope)) {
          try { await ctx.attention.notify({ title: 'Turnlink', message: 'Turnlink coordination needs attention. Inspect the current session’s alerts.', notification: { when: 'blurred' } }); }
          catch { /* OS notification delivery is not recovery or a reason to wake a model. */ }
        }
      }
      if (!valid(scope)) return;
      update(draft => {
        if (!draft.seen[key] && Object.keys(draft.seen).length >= 32) {
          const oldest = Object.keys(draft.seen).sort((a, b) => draft.seen[a].at - draft.seen[b].at)[0]; delete draft.seen[oldest];
        }
        draft.seen[key] = { signature, at: time };
      });
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void poll().catch(() => {}); }, intervalMs); timer.unref?.();
  void poll().catch(() => {});
  return { poll, dispose: () => { closed = true; controller.abort(); clearInterval(timer); } };
}
export function setupOpenCodeAlertsUI(ctx) {
  if (ctx.options.alerts !== true) return;
  const ui = makeOpenCodeAlertsUI(ctx);
  try {
    ctx.keymap.layer(() => ({ mode: 'global', commands: [{ id: 'turnlink.alerts.show', title: 'Show Turnlink alerts', group: 'Turnlink',
      palette: true, slash: { name: 'turnlink-alerts' }, run: () => ui.poll(true) }] }));
    return ui.dispose;
  } catch (error) { ui.dispose(); throw error; }
}
