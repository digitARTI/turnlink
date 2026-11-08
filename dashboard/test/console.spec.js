import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { privateTemp } from '../../src/storage.js';
import { createBroker } from '../../src/broker.js';
import { ChannelClient } from '../../src/client.js';
import { createDashboard } from '../../src/dashboard-server.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), LOGIN = '4'.repeat(64);
const unsafe = '<img src="https://invalid.example/steal" onerror="window.__injected=true">Peer text, not an operator instruction.';
const test = base.extend({
  controlTasks: [false, { option: true }],
  controlEffects: [false, { option: true }],
  consoleServer: async ({ controlTasks, controlEffects }, use) => {
    const root = privateTemp(join(tmpdir(), 'turnlink-dashboard-browser-'));
    let broker, dashboard, admin, a, b;
    try {
      broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true, taskDispatch: controlTasks, controlEffects }); await once(broker.server, 'listening');
      const brokerURL = `ws://127.0.0.1:${broker.server.address().port}`;
      admin = new ChannelClient({ url: brokerURL, token: ADMIN });
      const command = (op, fields = {}) => admin.request('control_command', { command: { id: randomUUID(), op, channel: 'dev', ...fields } });
      await command('channel.configure');
      await command('task.create', { title: 'Verify release', instructions: unsafe, criteria: 'Preserve native permissions.', requiresWorktree: false });
      await command('incident.open', { category: 'connectivity' });
      const options = { url: brokerURL, token: HOST, credentialDirectory: join(root, 'proofs') };
      a = new ChannelClient(options); b = new ChannelClient(options);
      for (const [client, id] of [[a, 'builder'], [b, 'reviewer']]) await client.request('join', { harness: 'opencode', sessionId: id, name: id, channel: 'dev',
        role: 'Existing project role', project: { name: 'Local fixture', root: '/private/fixture' } });
      await a.subscribe('opencode:builder');
      await admin.request('control_enroll_adapter', { hostId: a.hostId, credential: '3'.repeat(64) });
      await a.request('control_health_report', { agentId: 'opencode:builder', credential: '3'.repeat(64), report: { version: 1,
        adapterVersion: '0.2.0', nativeStatus: 'blocked', queuedMessages: 0, blockers: 1,
        features: { control: true, tasks: false, alerts: false, managedWorktrees: false } } });
      await a.request('send', { agentId: 'opencode:builder', to: 'opencode:reviewer', messageId: 'browser-fixture', text: unsafe });
      dashboard = createDashboard({ port: 0, channels: ['dev'], loginSecret: LOGIN, brokerToken: ADMIN, brokerURL }); await once(dashboard.server, 'listening');
      const peerCommand = async (client, sessionId, op, taskID) => {
        const agentId = `opencode:${sessionId}`; await client.subscribe(agentId);
        return client.request('control_command', { agentId, command: { id: randomUUID(), op, channel: 'dev', taskID } });
      };
      const adapterReport = (op, taskID, attempt, fields = {}) => a.request('control_adapter', { agentId: 'opencode:builder', credential: '3'.repeat(64),
        command: { id: randomUUID(), op, channel: 'dev', taskID, attempt, ...fields } });
      await use({ origin: `http://127.0.0.1:${dashboard.server.address().port}`, admin, command,
        claimTask: (taskID, who = 'builder') => peerCommand(who === 'builder' ? a : b, who, 'task.claim', taskID),
        releaseTask: taskID => peerCommand(a, 'builder', 'task.release', taskID), adapterReport,
        reviewTask: async taskID => {
          await peerCommand(a, 'builder', 'task.claim', taskID);
          const task = (await a.request('control_task_pull', { agentId: 'opencode:builder', credential: '3'.repeat(64), channel: 'dev', cwd: '/private/fixture', scopeDigest: 'a'.repeat(64) })).task;
          await adapterReport('task.admission', taskID, task.attempt, { outcome: 'admitted', receiptID: randomUUID(), admissionID: task.nativeAdmissionID });
          await adapterReport('task.started', taskID, task.attempt, { evidenceID: randomUUID() });
          const artifact = randomUUID();
          await a.request('control_adapter', { agentId: 'opencode:builder', credential: '3'.repeat(64), command: { id: artifact, op: 'evidence.record', channel: 'dev', entityID: taskID, kind: 'artifact', attempt: task.attempt } });
          await adapterReport('task.stopped', taskID, task.attempt, { evidenceID: randomUUID() });
          await a.request('control_command', { agentId: 'opencode:builder', command: { id: randomUUID(), op: 'task.report', channel: 'dev', taskID,
            summary: 'Participant report survives later uncertainty.', evidence: [artifact] } }); return task.attempt;
        },
        requestWakePolicy: async () => {
          await command('channel.configure', { mode: 'approval' });
          await b.subscribe('opencode:reviewer');
          const role = (op, fields) => b.request('control_command', { agentId: 'opencode:reviewer', command: { id: randomUUID(), op, channel: 'dev', ...fields } });
          await role('master.volunteer', { eligible: true });
          const proposal = await command('master.appoint', { candidate: 'opencode:reviewer' });
          const notice = (await b.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries.find(n => n.kind === 'offer');
          await b.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_browser_recovery_role' });
          await role('master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
          const generation = (await admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.active.generation;
          return role('action.request', { generation, operation: 'change_wake_policy', target: 'opencode:builder', wakePolicy: 'paused', evidence: 'not_applicable' });
        },
        acceptTask: async taskID => {
          await b.subscribe('opencode:reviewer');
          const role = (op, fields) => b.request('control_command', { agentId: 'opencode:reviewer', command: { id: randomUUID(), op, channel: 'dev', ...fields } });
          await role('master.volunteer', { eligible: true });
          const proposal = await command('master.appoint', { candidate: 'opencode:reviewer' });
          const notice = (await b.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries.find(n => n.kind === 'offer');
          await b.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_browser_terminal_role' });
          await role('master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
          const generation = (await admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.active.generation;
          const task = (await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0];
          await role('task.review', { taskID, generation, accept: true, evidenceID: task.result.evidence[0] });
        } });
    } finally {
      await dashboard?.close(); admin?.close(); a?.close(); b?.close(); await broker?.close(); rmSync(root, { recursive: true, force: true });
    }
  },
});
async function login(page, server) {
  await page.goto(server.origin);
  await page.getByLabel(/^Dashboard login/).fill(LOGIN);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('opencode:builder', { exact: true })).toBeVisible();
}
async function navigate(page, name) {
  if (page.viewportSize().width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('navigation', { name: 'Console sections' }).getByText(name, { exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}
async function accessible(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
}

test('sign-in, real status/views and responsive navigation are accessible in both themes', async ({ page, consoleServer }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(consoleServer.origin); await expect(page.getByRole('heading', { name: 'Operator sign-in' })).toBeVisible(); await accessible(page);
  await login(page, consoleServer); await accessible(page);
  await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true });
  const scheme = await page.locator('html').getAttribute('data-mantine-color-scheme');
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', scheme === 'dark' ? 'light' : 'dark'); await accessible(page);
  await navigate(page, 'Incidents'); await expect(page.getByRole('cell', { name: 'connectivity', exact: true })).toBeVisible();
  await navigate(page, 'Actions'); await expect(page.getByText('No records in this page.')).toBeVisible();
  await navigate(page, 'Evidence'); await expect(page.getByText('No records in this page.')).toBeVisible();
  await navigate(page, 'Events'); await expect(page.getByRole('cell', { name: 'task.created', exact: true })).toBeVisible();
  await navigate(page, 'Activity'); await expect(page.getByRole('cell', { name: 'message.queued', exact: true })).toBeVisible();
  await navigate(page, 'Health'); await expect(page.getByText('Observational metadata only', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'attention', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'disconnected', exact: true })).toBeVisible(); await accessible(page);
  await navigate(page, 'Storage'); await expect(page.getByRole('cell', { name: 'telemetry rows', exact: true })).toBeVisible(); await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Sign out' }).click(); await expect(page.getByRole('heading', { name: 'Operator sign-in' })).toBeVisible();
});

test('private peer content loads only by consent and is rendered as text, never HTML or external requests', async ({ page, consoleServer }) => {
  const external = []; page.on('request', request => { if (!request.url().startsWith(consoleServer.origin)) external.push(request.url()); });
  await login(page, consoleServer); await navigate(page, 'Messages');
  await expect(page.getByText(unsafe, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load private messages' }).click();
  await expect(page.getByText(unsafe, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__injected)).toBeUndefined(); expect(external).toEqual([]);
  const events = await consoleServer.admin.request('control_query', { channel: 'dev', view: 'events' });
  expect(events.entries.some(event => event.type === 'messages.viewed')).toBe(true);
  await accessible(page);
});

test('stale policy previews are rejected visibly and uncertain HTTP outcomes disable further mutations', async ({ page, consoleServer }) => {
  await login(page, consoleServer); await navigate(page, 'Governance');
  await page.getByRole('combobox', { name: 'Recovery mode', exact: true }).click(); await page.getByRole('option', { name: 'Approval required', exact: true }).click();
  await page.getByRole('button', { name: 'Preview policy' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  await consoleServer.command('channel.configure', { mode: 'automatic' });
  await page.getByRole('button', { name: 'Confirm command' }).click();
  await expect(page.getByText('PREVIEW_STALE', { exact: true })).toBeVisible();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.mode).toBe('automatic');
  await navigate(page, 'Tasks'); await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel(/^Title/).fill('Uncertain request'); await page.getByLabel(/^Instructions/).fill('Do not retry automatically.'); await page.getByLabel(/^Acceptance criteria/).fill('Inspect the exact command receipt.');
  await page.getByRole('button', { name: 'Preview task' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  let attempts = 0; await page.route('**/api/execute', route => { attempts++; return route.abort('failed'); });
  await page.getByRole('button', { name: 'Confirm command' }).click();
  await expect(page.getByText('Outcome uncertain. Do not repeat.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeDisabled(); expect(attempts).toBe(1);
  await page.getByRole('button', { name: 'Check receipt' }).click(); await expect(page.getByText(/No receipt is visible yet/)).toBeVisible();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.length).toBe(1);
  await accessible(page);
});

test('a lost HTTP reply leaves a discoverable broker receipt without duplicating a task or claiming native completion', async ({ page, consoleServer }) => {
  await login(page, consoleServer); await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'New task' }).click(); await page.getByLabel(/^Title/).fill('Receipt recovery');
  await page.getByLabel(/^Instructions/).fill('Record exactly once.'); await page.getByLabel(/^Acceptance criteria/).fill('No native execution or acceptance is inferred.');
  await page.getByRole('button', { name: 'Preview task' }).click(); await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  let attempts = 0;
  await page.route('**/api/execute', async route => { attempts++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Confirm command' }).click(); await expect(page.getByText('Outcome uncertain. Do not repeat.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check receipt' }).click(); await expect(page.getByText(/Broker receipt found/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByText('Receipt recovery', { exact: true })).toBeVisible();
  const tasks = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.filter(t => t.title === 'Receipt recovery');
  expect(tasks.length).toBe(1); expect(tasks[0].status).toBe('open'); expect(tasks[0].claimant).toBeNull(); expect(attempts).toBe(1);
});

test('task creation and policy changes require explicit confirmation and preserve voluntary claim boundaries', async ({ page, consoleServer }, info) => {
  await login(page, consoleServer); await navigate(page, 'Tasks');
  await expect(page.getByText('Verify release', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel(/^Title/).fill('Operator-created task');
  await page.getByLabel(/^Instructions/).fill('Keep the existing conversation and approvals.');
  await page.getByLabel(/^Acceptance criteria/).fill('Participant claims voluntarily and master accepts evidence.');
  await page.getByRole('button', { name: 'Preview task' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  let tasks = await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' }); expect(tasks.entries.length).toBe(1);
  await accessible(page); await page.screenshot({ path: info.outputPath('confirmation.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm command' }).click(); await expect(page.getByText('Operator-created task', { exact: true })).toBeVisible();
  tasks = await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' });
  const task = tasks.entries.find(task => task.title === 'Operator-created task'); expect(task.status).toBe('open'); expect(task.claimant).toBeNull(); expect(task.requiresWorktree).toBe(false);
  await navigate(page, 'Governance'); await page.getByRole('combobox', { name: 'Recovery mode', exact: true }).click(); await page.getByRole('option', { name: 'Approval required', exact: true }).click();
  await page.getByRole('button', { name: 'Preview policy' }).click(); await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.mode).toBe('safe');
  await page.getByRole('button', { name: 'Preview policy' }).click(); await page.getByRole('button', { name: 'Confirm command' }).click();
  await expect(page.getByText('Broker command recorded.', { exact: true })).toBeVisible();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.mode).toBe('approval');
  await accessible(page);
});

test('durable inbox requires explicit acknowledgement and preserves unresolved incidents across page reloads', async ({ page, consoleServer }, info) => {
  await login(page, consoleServer); await navigate(page, 'Notifications');
  await expect(page.getByRole('cell', { name: 'incident.opened', exact: true })).toBeVisible();
  const notices = await consoleServer.admin.request('control_notifications', { channel: 'dev' }); expect(notices.entries.length).toBe(1);
  const id = notices.entries[0].id; expect(notices.entries[0].acknowledgedAt).toBeNull();
  await accessible(page); await page.screenshot({ path: info.outputPath('notifications.png'), fullPage: true });
  await page.getByRole('button', { name: 'Preview acknowledgement' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  expect((await consoleServer.admin.request('control_notifications', { channel: 'dev', id })).acknowledgedAt).toBeNull();
  await accessible(page); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload(); await navigate(page, 'Notifications'); await expect(page.getByRole('button', { name: 'Preview acknowledgement' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview acknowledgement' }).click(); await page.getByRole('button', { name: 'Confirm command' }).click();
  await expect(page.getByText('Notification marked as seen. No recovery or resolution was performed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Recorded', exact: true })).toBeVisible();
  expect((await consoleServer.admin.request('control_notifications', { channel: 'dev', id })).acknowledgedAt).not.toBeNull();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'incidents' })).entries[0].status).toBe('open');
  await page.reload(); await navigate(page, 'Notifications'); await expect(page.getByRole('cell', { name: 'Recorded', exact: true })).toBeVisible();
  await consoleServer.command('incident.open', { category: 'storage' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByRole('button', { name: 'Preview acknowledgement' })).toHaveCount(1);
  await accessible(page);
});

test('lost acknowledgement HTTP reply is investigated read-only and never automatically resent', async ({ page, consoleServer }) => {
  await login(page, consoleServer); await navigate(page, 'Notifications');
  await page.getByRole('button', { name: 'Preview acknowledgement' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  let sends = 0;
  await page.route('**/api/execute', async route => { sends++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Confirm command' }).click();
  await expect(page.getByText('Outcome uncertain. Do not repeat.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check receipt' }).click();
  await expect(page.getByText(/Acknowledgement receipt found/)).toBeVisible(); expect(sends).toBe(1);
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'incidents' })).entries[0].status).toBe('open');
  await accessible(page);
});

test.describe('explicit UTC task metadata', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('dependencies, priority and UTC timing survive a local DST gap without claiming or running work', async ({ page, consoleServer }, info) => {
    await login(page, consoleServer); await navigate(page, 'Tasks');
    const dependency = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].id;
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel(/^Title/).fill('Scheduled metadata fixture');
    await page.getByLabel(/^Instructions/).fill('Do not bypass native approvals or dependencies.');
    await page.getByLabel(/^Acceptance criteria/).fill('Voluntary claim and explicit master review remain required.');
    await page.getByLabel(/^Dependency task IDs/).fill(`${dependency}, ${dependency}`);
    await page.getByLabel(/^Priority/).fill('91');
    await page.getByLabel(/^Progress timeout \(seconds\)/).fill('120');
    // This wall-clock time does not exist locally in New York. The form says UTC.
    await page.getByLabel(/^Scheduled start \(UTC\)/).fill('2028-03-12T02:30');
    await page.getByLabel(/^Deadline \(UTC\)/).fill('2028-03-13T03:00');
    await expect(page.getByRole('combobox', { name: 'Missed-schedule policy' })).toHaveValue('Ask the operator (default)');
    await page.getByLabel(/^Maximum lateness \(seconds\)/).fill('25');
    await page.getByRole('button', { name: 'Preview task' }).click();
    await expect(page.getByText('Use at most 64 distinct dependency task IDs.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
    await page.getByLabel(/^Dependency task IDs/).fill(dependency);
    await accessible(page); await page.screenshot({ path: info.outputPath('advanced-task-form.png'), fullPage: true });
    await page.getByRole('button', { name: 'Preview task' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
    const details = page.getByRole('region', { name: 'Task scheduling details' });
    await expect(details).toContainText('2028-03-12T02:30:00.000Z'); await expect(details).toContainText('2028-03-13T03:00:00.000Z');
    await expect(details).toContainText('"missedPolicy": "ask"');
    expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.length).toBe(1);
    await accessible(page); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'New task' }).click(); await page.getByRole('button', { name: 'Preview task' }).click();
    await page.getByRole('button', { name: 'Confirm command' }).click();
    await expect(page.getByText('Scheduled metadata fixture', { exact: true })).toBeVisible();
    const task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.find(t => t.title === 'Scheduled metadata fixture');
    expect(task.priority).toBe(91); expect(task.dependencies).toEqual([dependency]); expect(task.progressTimeoutMs).toBe(120000);
    expect(task.schedule).toEqual({ at: Date.UTC(2028, 2, 12, 2, 30), missed: 'ask', maxLatenessMs: 25000 });
    expect(task.deadlineAt).toBe(Date.UTC(2028, 2, 13, 3)); expect(task.status).toBe('open'); expect(task.claimant).toBeNull();
    expect(task.attempt).toBe(0); expect(task.requiresWorktree).toBe(false); expect(task.missedDecision).toBeUndefined(); await accessible(page);
  });
});

test('reassignment is explicit, rejects changed claims and only reopens for voluntary claims', async ({ page, consoleServer }, info) => {
  const taskID = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].id;
  await consoleServer.claimTask(taskID); await login(page, consoleServer); await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Preview reassignment' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Affected recovery proposal' })).toContainText('opencode:builder');
  await accessible(page); await page.screenshot({ path: info.outputPath('reassignment-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].claimant).toBe('opencode:builder');
  await page.getByRole('button', { name: 'Preview reassignment' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  await consoleServer.releaseTask(taskID); await consoleServer.claimTask(taskID, 'reviewer');
  await page.getByRole('button', { name: 'Confirm command' }).click(); await expect(page.getByText('PREVIEW_STALE', { exact: true })).toBeVisible();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].claimant).toBe('opencode:reviewer');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('button', { name: 'Preview reassignment' }).click();
  await expect(page.getByRole('region', { name: 'Affected recovery proposal' })).toContainText('opencode:reviewer');
  await page.getByRole('button', { name: 'Confirm command' }).click(); await expect(page.getByText('Broker command recorded.', { exact: true })).toBeVisible();
  const task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
  expect(task.status).toBe('open'); expect(task.claimant).toBeNull(); expect(task.attempt).toBe(1);
  await expect(page.getByRole('button', { name: 'Preview reassignment' })).toHaveCount(0); await accessible(page);
});

test('lost reassignment HTTP reply is investigated without repeating or releasing a subsequent claim', async ({ page, consoleServer }) => {
  const taskID = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].id;
  await consoleServer.claimTask(taskID); await login(page, consoleServer); await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Preview reassignment' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm broker command' })).toBeVisible();
  let attempts = 0;
  await page.route('**/api/execute', async route => { attempts++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Confirm command' }).click(); await expect(page.getByText('Outcome uncertain. Do not repeat.', { exact: true })).toBeVisible();
  await consoleServer.claimTask(taskID, 'reviewer');
  await page.getByRole('button', { name: 'Check receipt' }).click(); await expect(page.getByText(/Broker receipt found/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview reassignment' })).toBeDisabled();
  expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].claimant).toBe('opencode:reviewer');
  expect(attempts).toBe(1); await accessible(page);
});

test.describe('review-phase native uncertainty metadata', () => {
  test.use({ controlTasks: true });
  test('the report survives while review is held, and fresh stop restores only pending master review', async ({ page, consoleServer }, info) => {
    const taskID = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].id;
    const attempt = await consoleServer.reviewTask(taskID);
    await login(page, consoleServer); await navigate(page, 'Tasks');
    await page.getByText('Instructions, criteria and result', { exact: true }).click();
    await expect(page.getByText('Participant report survives later uncertainty.', { exact: true })).toBeVisible();
    await consoleServer.adapterReport('task.uncertain', taskID, attempt);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Review held: stop evidence missing', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant report survives later uncertainty.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview reassignment' })).toHaveCount(0);
    await accessible(page); await page.screenshot({ path: info.outputPath('review-held.png'), fullPage: true });
    const held = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
    expect(held.stopGeneration).toBe(1);
    await expect(consoleServer.adapterReport('task.stopped', taskID, attempt, { evidenceID: randomUUID(), stopGeneration: 0 })).rejects.toThrow('STALE_STOP_GENERATION');
    await consoleServer.adapterReport('task.stopped', taskID, attempt, { evidenceID: randomUUID(), stopGeneration: held.stopGeneration });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Review held: stop evidence missing', { exact: true })).toHaveCount(0);
    const task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
    expect(task.status).toBe('review'); expect(task.result.summary).toBe('Participant report survives later uncertainty.');
    expect(task.stoppedEvidence).toBeTruthy(); expect(task.claimant).toBe('opencode:builder'); await accessible(page);
  });
  test('late stop-confirmation hold remains visible without undoing completed acceptance', async ({ page, consoleServer }, info) => {
    const taskID = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0].id;
    const attempt = await consoleServer.reviewTask(taskID); await consoleServer.acceptTask(taskID);
    await login(page, consoleServer); await navigate(page, 'Tasks');
    await consoleServer.adapterReport('task.uncertain', taskID, attempt);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Terminal task: stop-confirmation hold', { exact: true })).toBeVisible();
    let task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
    expect(task.status).toBe('completed'); expect(task.terminalHold).toBe(true);
    expect(task.result.summary).toBe('Participant report survives later uncertainty.');
    expect((await consoleServer.admin.request('control_query', { channel: 'dev', view: 'health' })).entries.find(h => h.agentId === 'opencode:builder').uncertainTasks).toBe(1);
    await expect(page.getByRole('button', { name: 'Preview reassignment' })).toHaveCount(0);
    await accessible(page); await page.screenshot({ path: info.outputPath('terminal-held.png'), fullPage: true });
    await consoleServer.adapterReport('task.uncertain', taskID, attempt);
    await expect(consoleServer.adapterReport('task.stopped', taskID, attempt, { evidenceID: randomUUID(), holdGeneration: task.terminalHoldGeneration })).rejects.toThrow('STALE_TERMINAL_HOLD');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText(/Broker hold generation: 2/)).toBeVisible();
    task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
    await consoleServer.adapterReport('task.stopped', taskID, attempt, { evidenceID: randomUUID(), holdGeneration: task.terminalHoldGeneration });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Terminal task: stop-confirmation hold', { exact: true })).toHaveCount(0);
    task = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries[0];
    expect(task.status).toBe('completed'); expect(task.terminalHold).toBe(false); await accessible(page);
  });
});


test.describe('recovery approval details', () => {
  test.use({ controlEffects: true });
  test('wake-policy approval previews the exact proposal before any effect', async ({ page, consoleServer }) => {
    const action = await consoleServer.requestWakePolicy();
    await login(page, consoleServer); await navigate(page, 'Actions');
    await page.getByRole('button', { name: 'Preview approval', exact: true }).click();
    const details = page.getByRole('region', { name: 'Affected recovery proposal' });
    await expect(details).toContainText('"wakePolicy": "paused"');
    await expect(details).toContainText('opencode:builder');
    await expect(details).toContainText(action.commandID);
    await expect(details).toContainText('Changes subsequent adapter admission policy');
    await accessible(page);
    const before = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'actions', entityID: action.commandID })).entries[0];
    expect(before.status).toBe('awaiting_approval');
    await page.getByRole('button', { name: 'Close confirmation', exact: true }).click();
    const after = (await consoleServer.admin.request('control_query', { channel: 'dev', view: 'actions', entityID: action.commandID })).entries[0];
    expect(after.status).toBe('awaiting_approval');
  });
});
