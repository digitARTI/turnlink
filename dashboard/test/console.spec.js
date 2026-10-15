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
  consoleServer: async ({}, use) => {
    const root = privateTemp(join(tmpdir(), 'turnlink-dashboard-browser-'));
    let broker, dashboard, admin, a, b;
    try {
      broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true }); await once(broker.server, 'listening');
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
      await a.request('send', { agentId: 'opencode:builder', to: 'opencode:reviewer', messageId: 'browser-fixture', text: unsafe });
      dashboard = createDashboard({ port: 0, channels: ['dev'], loginSecret: LOGIN, brokerToken: ADMIN, brokerURL }); await once(dashboard.server, 'listening');
      await use({ origin: `http://127.0.0.1:${dashboard.server.address().port}`, admin, command });
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
