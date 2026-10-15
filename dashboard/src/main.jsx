import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme, DEFAULT_THEME, AppShell, Group, Text, Title, Button, Badge, Stack, Select, NavLink, Burger,
  Paper, PasswordInput, TextInput, Textarea, Alert, Skeleton, Table, Code, Modal, Switch, SimpleGrid, Divider,
  useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './style.css';
import { api } from './api.js';

const theme = createTheme({ primaryColor: 'teal', primaryShade: 9, defaultRadius: 'sm', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  colors: { teal: [...DEFAULT_THEME.colors.teal.slice(0, 8), '#087f5b', '#066649'] },
  headings: { fontFamily: 'inherit', fontWeight: '600' } });
const modeLabel = { safe: 'Safe automatic', automatic: 'Automatic', approval: 'Approval required' };
const sections = ['Overview', 'Tasks', 'Messages', 'Incidents', 'Actions', 'Governance', 'Evidence', 'Events', 'Activity', 'Storage'];
const viewFor = { Overview: 'channel', Governance: 'channel', Tasks: 'tasks', Messages: 'messages', Incidents: 'incidents', Actions: 'actions', Evidence: 'evidence', Events: 'events', Activity: 'activity' };
const stamp = value => value == null ? 'Not available' : new Date(value).toLocaleString();
const count = value => typeof value === 'number' ? value.toLocaleString() : 'Not available';
const identifier = value => <Code className="identifier">{value || 'None'}</Code>;
function StateBadge({ value }) {
  const color = ['critical', 'failed', 'uncertain', 'unavailable', 'rejected'].includes(value) ? 'red'
    : ['warning', 'review', 'awaiting_approval', 'prepared'].includes(value) ? 'yellow' : ['ok', 'completed', 'succeeded'].includes(value) ? 'teal' : 'gray';
  return <Badge color={color} variant="outline" styles={{ label: { color: 'var(--mantine-color-text)' } }}>{value?.replaceAll('_', ' ') || 'Unknown'}</Badge>;
}
function Loading() { return <Stack aria-label="Loading data" aria-busy="true">{[1, 2, 3].map(i => <Skeleton key={i} height={42} animate={false} />)}</Stack>; }
function Empty({ children = 'No records in this page.' }) { return <Paper withBorder p="xl"><Text className="muted">{children}</Text></Paper>; }
function ErrorPanel({ error }) { return <Alert color="red" title="Data unavailable" role="alert">{error.message}. No recovery action was attempted.</Alert>; }
function useRemote(path, tick, expired) {
  const [state, setState] = useState({});
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController(); setState(old => ({ ...(old.path === path ? old : {}), path, loading: true }));
    api(path, { signal: controller.signal }).then(value => setState({ path, value, checkedAt: Date.now(), loading: false }))
      .catch(error => { if (controller.signal.aborted) return; if (error.status === 401) expired(); else setState({ path, error, loading: false }); });
    return () => controller.abort();
  }, [path, tick, expired]);
  return state.path === path ? state : { loading: !!path };
}
function ThemeButton() {
  const { setColorScheme } = useMantineColorScheme(), colorScheme = useComputedColorScheme('light');
  return <Button variant="default" size="xs" onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}>Switch theme</Button>;
}
function Login({ onLogin }) {
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/login', { body: { password } }); setPassword(''); await onLogin(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <main className="login"><Paper withBorder p="xl" className="login-panel">
    <Group justify="space-between"><Text fw={700}>Turnlink</Text><ThemeButton /></Group>
    <Title order={1} mt="xl" size="h2">Operator sign-in</Title>
    <Text className="muted" mt="xs" mb="lg">Private, loopback-only access. Use the separate dashboard login, never the broker credential.</Text>
    <form onSubmit={submit}><Stack>
      <PasswordInput label="Dashboard login" description="Read the dashboard-login.token file on the operator host." autoComplete="current-password" required value={password} onChange={event => setPassword(event.currentTarget.value)} />
      {error && <Alert color="red" role="alert" title="Sign-in failed">{error}</Alert>}
      <Button type="submit" loading={busy}>Sign in</Button>
    </Stack></form>
  </Paper></main>;
}
function Paged({ data, columns, row }) {
  if (!data?.entries?.length) return <Empty />;
  return <Table.ScrollContainer minWidth={650} type="native" tabIndex={0} role="region" aria-label="Scrollable records table"><Table verticalSpacing="sm" highlightOnHover>
    <Table.Thead><Table.Tr>{columns.map(name => <Table.Th key={name}>{name}</Table.Th>)}</Table.Tr></Table.Thead>
    <Table.Tbody>{data.entries.map(entry => <Table.Tr key={entry.id}>{row(entry)}</Table.Tr>)}</Table.Tbody>
  </Table></Table.ScrollContainer>;
}
function Tasks({ data, propose, disabled }) {
  const [opened, setOpened] = useState(false), [form, setForm] = useState({ title: '', instructions: '', criteria: '' });
  return <Stack><Group justify="space-between"><Text className="muted">Claims are voluntary. Only the master can accept a participant’s result.</Text>
    <Button disabled={disabled} onClick={() => setOpened(true)}>New task</Button></Group>
    {!data.entries.length && <Empty>Create a task, then let a participant explicitly claim it. No task runs merely because it appears here.</Empty>}
    {data.entries.map(task => <Paper key={task.id} withBorder p="md"><Group justify="space-between" align="start">
      <div><Text fw={600}>{task.title}</Text>{identifier(task.id)}</div><StateBadge value={task.status} /></Group>
      <Group gap="lg" mt="sm"><Text size="sm">Claimant: {task.claimant || 'Unclaimed'}</Text><Text size="sm">Priority {task.priority}</Text>
        <Text size="sm">Attempt {task.attempt}</Text><Text size="sm">{task.requiresWorktree ? 'Worktree required · blocked' : 'Existing conversation'}</Text></Group>
      {task.schedule && <Text size="sm" mt="xs">Scheduled: {stamp(task.schedule.at)} · missed policy: {task.schedule.missed}</Text>}
      {task.deadlineAt && <Text size="sm">Deadline: {stamp(task.deadlineAt)}</Text>}
      <details className="detail"><summary>Instructions, criteria and result</summary><Stack gap="xs" mt="sm">
        <Text fw={600} size="sm">Instructions</Text><Text className="collaboration">{task.instructions}</Text>
        <Text fw={600} size="sm">Acceptance criteria</Text><Text className="collaboration">{task.criteria}</Text>
        {task.result && <><Text fw={600} size="sm">Participant report</Text><Text className="collaboration">{task.result.summary}</Text><Text size="sm">Artifact references: {task.result.evidence.join(', ')}</Text></>}
        <Text size="sm">Stop evidence: {task.stoppedEvidence || 'Not recorded'}</Text>
        <Text size="sm">Dependencies: {task.dependencies.length ? task.dependencies.join(', ') : 'None'}</Text>
      </Stack></details>
      {task.schedule?.missed === 'ask' && !task.missedDecision && ['open', 'claimed'].includes(task.status) && Date.now() > task.schedule.at + task.schedule.maxLatenessMs &&
        <Group mt="md"><Button size="xs" disabled={disabled} onClick={() => propose('task.missed', { taskID: task.id, run: true })}>Preview run late</Button>
          <Button size="xs" variant="default" disabled={disabled} onClick={() => propose('task.missed', { taskID: task.id, run: false })}>Preview skip</Button></Group>}
    </Paper>)}
    <Modal opened={opened} onClose={() => setOpened(false)} title="New task" size="lg" transitionProps={{ duration: 0 }} closeButtonProps={{ 'aria-label': 'Close task form' }}>
      <form onSubmit={event => { event.preventDefault(); setOpened(false); propose('task.create', { ...form, requiresWorktree: false }); }}><Stack>
        <TextInput label="Title" maxLength={200} required value={form.title} onChange={e => setForm({ ...form, title: e.currentTarget.value })} />
        <Textarea label="Instructions" description="Collaboration content, not an override of native instructions or permissions." minRows={4} maxLength={12000} required value={form.instructions} onChange={e => setForm({ ...form, instructions: e.currentTarget.value })} />
        <Textarea label="Acceptance criteria" minRows={3} maxLength={4000} required value={form.criteria} onChange={e => setForm({ ...form, criteria: e.currentTarget.value })} />
        <Text size="sm" className="muted">Uses the existing conversation/cwd only. Managed worktree execution is unavailable.</Text><Button type="submit">Preview task</Button>
      </Stack></form>
    </Modal>
  </Stack>;
}
function Governance({ data, propose, disabled }) {
  const channel = data.channel, [mode, setMode] = useState(channel.mode), [elections, setElections] = useState(channel.electionsEnabled), [candidate, setCandidate] = useState(null);
  useEffect(() => { setMode(channel.mode); setElections(channel.electionsEnabled); setCandidate(null); }, [channel.id, channel.policyRevision]);
  return <Stack gap="xl"><div><Title order={2} size="h3">Recovery policy</Title><Text className="muted" mt="xs">No mode bypasses native approvals or permits uncertain blind replay.</Text>
    <Stack mt="md" maw={460}><Select label="Recovery mode" allowDeselect={false} value={mode} onChange={setMode} data={Object.entries(modeLabel).map(([value, label]) => ({ value, label }))} />
      <Switch label="Allow volunteer elections" checked={elections} onChange={e => setElections(e.currentTarget.checked)} />
      <Button disabled={disabled || (mode === channel.mode && elections === channel.electionsEnabled)} onClick={() => propose('channel.configure', { mode, electionsEnabled: elections })}>Preview policy</Button></Stack></div>
    <Divider /><div><Title order={2} size="h3">Master authority</Title>
      <Text mt="sm">Active: {channel.active?.agentId || 'No active master'}</Text><Text size="sm" className="muted">Lease expiry: {stamp(channel.active?.expiresAt)}</Text>
      {channel.proposal && <Alert mt="md" title="Replacement awaiting acceptance">{channel.proposal.agentId}. The existing master remains active until the exact proposal is accepted.</Alert>}
      <Stack maw={460} mt="md"><Select label="Volunteer candidate" placeholder="Select a connected volunteer" value={candidate} onChange={setCandidate}
        data={channel.volunteers.map(id => ({ value: id, label: id, disabled: !data.members.some(m => m.agentId === id && m.connected) }))} />
        <Group><Button disabled={disabled || !candidate} onClick={() => propose('master.appoint', { candidate })}>Preview appointment</Button>
          <Button color="red" variant="outline" disabled={disabled || (!channel.active && !channel.proposal)} onClick={() => propose('master.revoke')}>Preview revocation</Button></Group></Stack>
      <Text className="muted" size="sm" mt="md">Roles supplement existing instructions. They confer no new tools or permissions.</Text></div>
    <Divider /><div><Title order={2} size="h3">Election</Title>{channel.election ? <Stack mt="md">
      <Text>Deadline: {stamp(channel.election.deadline)} · absolute majority of the frozen electorate required.</Text>
      <Text>Electorate: {channel.election.electorate.join(', ')}</Text><Text>Candidates: {channel.election.candidates.join(', ')}</Text>
      <Text>Ballots received: {Object.keys(channel.election.ballots).length} / {channel.election.electorate.length}</Text>
    </Stack> : <Text mt="sm" className="muted">No election in progress. Participants volunteer and vote through their existing conversation.</Text>}</div>
  </Stack>;
}
function ChannelOverview({ data, info }) {
  const { channel, members } = data;
  return <Stack gap="lg"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><div className="readout"><Text className="muted" size="sm">Recovery mode</Text><Text fw={600} size="xl">{modeLabel[channel.mode]}</Text></div>
    <div className="readout"><Text className="muted" size="sm">Master</Text><Text fw={600}>{channel.active?.agentId || 'No active master'}</Text><Text size="sm" className="muted">Generation {channel.generation}</Text></div></SimpleGrid>
    <Alert title="Native boundaries remain in force" color="gray">Managed worktree execution is disabled. Task execution is {info?.taskDispatchEnabled ? `opt-in for ${info.taskExecutionHarnesses.join(', ')}` : 'disabled'}. Approval and permission settings remain native.</Alert>
    <Title order={2} size="h3">Participants</Title>
    {!members.length ? <Empty>No enrolled participants in this channel.</Empty> : <Table.ScrollContainer minWidth={650} type="native" tabIndex={0} role="region" aria-label="Participants table"><Table verticalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>Participant</Table.Th><Table.Th>Harness</Table.Th><Table.Th>Receiver</Table.Th><Table.Th>Role</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{members.map(m => <Table.Tr key={m.agentId}><Table.Td>{identifier(m.agentId)}</Table.Td><Table.Td>{m.harness}</Table.Td>
        <Table.Td>{m.connected ? 'Connected' : 'Disconnected / reserved'}</Table.Td><Table.Td>{m.role || 'Not advertised'}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer>}</Stack>;
}
function Storage({ status }) {
  const { storage, activity } = status;
  return <Stack><Group><Title order={2} size="h3">Storage pressure</Title><StateBadge value={storage.pressure.level} /></Group>
    <Text className="muted">Export does not reclaim durable receipt capacity. Never delete unresolved evidence to make space.</Text>
    {storage.unresolved && <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">{Object.entries(storage.unresolved).map(([name, value]) => <div className="readout" key={name}><Text size="sm" className="muted">Unresolved {name}</Text><Text fw={600} className="numeric">{count(value)}</Text></div>)}</SimpleGrid>}
    <Table.ScrollContainer minWidth={600} type="native" tabIndex={0} role="region" aria-label="Storage quotas table"><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Resource</Table.Th><Table.Th>Used</Table.Th><Table.Th>Limit</Table.Th><Table.Th>Pressure</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{storage.quotas.map(q => <Table.Tr key={q.resource}><Table.Td>{q.resource.replaceAll('_', ' ')}</Table.Td><Table.Td className="numeric">{count(q.used)}</Table.Td><Table.Td className="numeric">{count(q.limit)}</Table.Td><Table.Td><StateBadge value={q.level} /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
    {!storage.quotas.length && <Alert color="red" title="Storage diagnostics unavailable">No capacity or recovery claim can be made from this response.</Alert>}
    <Divider /><Title order={2} size="h3">Observation coverage</Title><Text>Coverage: {activity.coverage} · rejected: {count(activity.rejected)} · unpersisted: {count(activity.unpersisted)}</Text>
    <Text className="muted">A zero loss counter does not prove uninterrupted history. Telemetry never authorizes replay.</Text>
    <Text size="sm">Retention last checked: {stamp(activity.lastPrunedAt)} · pruning {activity.pruningAvailable ? 'available' : 'unavailable'}</Text>
    <Alert title="Private export stays on the operator host" color="gray">Use <Code>npm run control-admin -- export /absolute/private-directory/new-export.jsonl</Code>. Exports contain collaboration content and are not public/redacted backups.</Alert>
  </Stack>;
}
function Workspace({ session, expired }) {
  const [channel, setChannel] = useState(session.channels[0]), [section, setSection] = useState('Overview'), [mobile, setMobile] = useState(false);
  const [tick, setTick] = useState(0), [cursors, setCursors] = useState([0]), [messageConsent, setMessageConsent] = useState(false);
  const [preview, setPreview] = useState(null), [pending, setPending] = useState(false), [notice, setNotice] = useState(null), [uncertain, setUncertain] = useState(false);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setTick(n => n + 1); }, 15000); return () => clearInterval(timer); }, []);
  const status = useRemote('/api/status', tick, expired), view = viewFor[section], cursor = cursors.at(-1);
  const path = !view || (section === 'Messages' && !messageConsent) ? null : `/api/channels/${encodeURIComponent(channel)}/${view}?${['activity', 'events'].includes(view) ? 'after' : 'offset'}=${cursor}`;
  const resource = useRemote(path, tick, expired), disabled = pending || uncertain || status.value?.control.available !== true;
  const navigate = value => { setSection(value); setCursors([0]); setMessageConsent(false); setMobile(false); };
  const propose = async (op, fields = {}) => {
    if (disabled) return;
    setPending(true); setNotice(null);
    try { const value = await api('/api/preview', { csrf: session.csrf, body: { command: { id: crypto.randomUUID(), channel, op, ...fields } } }); setPreview(value); }
    catch (error) { if (error.status === 401) expired(); else setNotice({ error: error.message }); }
    finally { setPending(false); }
  };
  async function execute() {
    if (!preview || disabled) return;
    setPending(true);
    try {
      const result = await api('/api/execute', { csrf: session.csrf, body: { previewID: preview.previewID } });
      setNotice({ message: 'Broker command recorded.', commandID: result.commandID }); setPreview(null); setTick(n => n + 1);
    } catch (error) {
      if (error.status === 401) expired();
      else {
        const unknown = !error.status || ['COMMAND_OUTCOME_UNCERTAIN', 'COMMAND_UNCERTAIN_OR_PENDING'].includes(error.message);
        setUncertain(unknown); setNotice({ error: error.message, commandID: error.commandID || preview.command.id, commandChannel: preview.command.channel, uncertain: unknown }); setPreview(null);
      }
    } finally { setPending(false); }
  }
  async function signOut() {
    try { await api('/api/logout', { csrf: session.csrf, body: {} }); expired(); }
    catch (error) { setNotice({ error: error.message }); }
  }
  async function checkReceipt() {
    try {
      const receipt = await api(`/api/receipt?channel=${encodeURIComponent(notice.commandChannel)}&commandID=${encodeURIComponent(notice.commandID)}`);
      setNotice(old => ({ ...old, receipt }));
    } catch (error) { if (error.status === 401) expired(); else setNotice(old => ({ ...old, receiptError: error.message })); }
  }
  const page = resource.value, info = status.value?.control;
  return <AppShell header={{ height: 64 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !mobile } }} padding={{ base: 'md', md: 'xl' }}>
    <AppShell.Header><Group h="100%" px="md" justify="space-between"><Group gap="md"><Burger opened={mobile} onClick={() => setMobile(!mobile)} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
      <Text fw={700} size="lg">Turnlink</Text><Badge variant="outline" color="gray" visibleFrom="sm">Operator console</Badge></Group>
      <Group gap="xs"><ThemeButton /><Button size="xs" variant="default" onClick={signOut} disabled={pending}>Sign out</Button></Group></Group></AppShell.Header>
    <AppShell.Navbar p="md"><Select label="Channel" data={session.channels} value={channel} allowDeselect={false} onChange={value => { setChannel(value); setCursors([0]); setMessageConsent(false); }} mb="lg" />
      <nav aria-label="Console sections">{sections.map(name => <NavLink component="button" type="button" variant="filled" key={name} label={name} active={name === section} aria-current={name === section ? 'page' : undefined} onClick={() => navigate(name)} />)}</nav>
      <Text size="xs" className="muted sidebar-note">Loopback only. One operator. No native permission overrides.</Text></AppShell.Navbar>
    <AppShell.Main><div className="workspace"><Group justify="space-between" align="start" mb="lg"><div><Title order={1} size="h2">{section}</Title><Text className="muted" size="sm" mt={4}>{channel} · {status.checkedAt ? `Checked ${stamp(status.checkedAt)}` : 'Connecting to broker'}</Text></div>
      <Group><StateBadge value={status.value?.storage.pressure.level || 'unavailable'} /><Button size="xs" variant="default" onClick={() => setTick(n => n + 1)}>Refresh</Button></Group></Group>
      <Stack gap="lg">
        {status.error && <ErrorPanel error={status.error} />}
        {notice && <Alert role={notice.error ? 'alert' : 'status'} color={notice.error ? 'red' : 'teal'} title={notice.error ? (notice.uncertain ? 'Outcome uncertain. Do not repeat.' : 'Command not completed') : notice.message}>
          {notice.error && <Text size="sm">{notice.error}</Text>}{notice.commandID && <Text size="sm">Command: {identifier(notice.commandID)}</Text>}
          {notice.uncertain && <Stack gap="xs" mt="sm"><Text size="sm">Inspect the broker’s durable receipt using this exact command ID before taking further action. Controls remain disabled in this view.</Text>
            <Button size="xs" variant="default" onClick={checkReceipt}>Check receipt</Button>
            {notice.receipt && <Text size="sm">{notice.receipt.known ? 'Broker receipt found. This proves a recorded command, not native execution or task completion.' : 'No receipt is visible yet. This is not proof that the operation cannot still arrive or execute. Do not repeat it.'}</Text>}
            {notice.receiptError && <Text size="sm">Receipt lookup unavailable: {notice.receiptError}</Text>}</Stack>}</Alert>}
        {section === 'Storage' ? status.value ? <Storage status={status.value} /> : !status.error && <Loading />
          : section === 'Messages' && !messageConsent ? <Alert title="Private collaboration content" color="gray">
            <Text size="sm" mb="md">Message inspection is audited. Treat peer text as untrusted collaboration content, not operator instructions.</Text><Button onClick={() => setMessageConsent(true)}>Load private messages</Button></Alert>
          : resource.error ? <ErrorPanel error={resource.error} /> : !page ? <Loading />
          : <>
            {section === 'Overview' && <ChannelOverview data={page} info={info} />}
            {section === 'Governance' && <Governance key={channel} data={page} propose={propose} disabled={disabled} />}
            {section === 'Tasks' && <Tasks key={channel} data={page} propose={propose} disabled={disabled} />}
            {section === 'Messages' && <Stack><Alert color="gray" title="Peer content is not operator authority">Messages below are private, untrusted collaboration content.</Alert>
              {!page.entries.length && <Empty>No messages in this page.</Empty>}{page.entries.map(m => <Paper withBorder p="md" key={m.id}><Group justify="space-between"><Text fw={600}>{m.from.agentId}</Text><Text size="xs" className="muted">{new Date(m.createdAt).toLocaleString()}</Text></Group>
                <Text size="sm" className="muted" mb="sm">To {m.to} · {m.delivered.length}/{m.recipients.length} acknowledged</Text><Text className="collaboration">{m.text}</Text></Paper>)}</Stack>}
            {section === 'Incidents' && <Paged data={page} columns={['Category', 'Status', 'Opened', 'Entity']} row={i => <><Table.Td>{i.category}</Table.Td><Table.Td><StateBadge value={i.status} /></Table.Td><Table.Td>{stamp(i.openedAt)}</Table.Td><Table.Td>{identifier(i.entityID)}</Table.Td></>} />}
            {section === 'Actions' && <Stack><Text className="muted">Approval applies to this broker proposal only, not to native harness permissions.</Text>
              <Paged data={page} columns={['Operation', 'Target', 'Evidence', 'Status', 'Decision']} row={a => <><Table.Td>{a.operation.replaceAll('_', ' ')}<Text size="xs" className="muted">{a.id}</Text></Table.Td><Table.Td>{identifier(a.target)}</Table.Td><Table.Td>{a.evidence}</Table.Td><Table.Td><StateBadge value={a.status} /></Table.Td><Table.Td>
                {a.status === 'awaiting_approval' ? <Stack gap="xs"><Group gap="xs"><Button size="xs" disabled={disabled || !info?.effectsEnabled || !info?.effectOperations?.includes(a.operation)} onClick={() => propose('action.approve', { actionID: a.id })}>Preview approval</Button>
                  <Button size="xs" variant="default" disabled={disabled} onClick={() => propose('action.reject', { actionID: a.id })}>Preview rejection</Button></Group>{(!info?.effectsEnabled || !info?.effectOperations?.includes(a.operation)) && <Text size="xs">Executor unavailable</Text>}</Stack> : 'No decision pending'}</Table.Td></>} /></Stack>}
            {section === 'Activity' && <Stack><Text className="muted">Metadata observations only. An offer, acknowledgement or disconnect is not native stop proof.</Text><Paged data={page} columns={['Observed', 'Type', 'Participant', 'Message']} row={a => <><Table.Td>{stamp(a.at)}</Table.Td><Table.Td>{a.type}</Table.Td><Table.Td>{identifier(a.agentId)}</Table.Td><Table.Td>{identifier(a.messageID)}</Table.Td></>} /></Stack>}
            {section === 'Evidence' && <Stack><Text className="muted">Adapter records are distinct from participant reports and master acceptance. Artifact references do not independently prove correctness.</Text><Paged data={page} columns={['Kind', 'Entity', 'Adapter', 'Recorded', 'Reference']} row={e => <><Table.Td>{e.kind}</Table.Td><Table.Td>{identifier(e.entityID)}</Table.Td><Table.Td>{identifier(e.agentId)}</Table.Td><Table.Td>{stamp(e.at)}</Table.Td><Table.Td><details><summary>Evidence details</summary><Code block className="command-preview" tabIndex={0} role="region" aria-label="Evidence record">{JSON.stringify(e, null, 2)}</Code></details></Table.Td></>} /></Stack>}
            {section === 'Events' && <Paged data={page} columns={['Time', 'Event', 'Actor', 'Entity']} row={e => <><Table.Td>{stamp(e.at)}</Table.Td><Table.Td>{e.type}</Table.Td><Table.Td>{e.actor.kind}{e.actor.agentId && <Text size="xs">{e.actor.agentId}</Text>}</Table.Td><Table.Td>{identifier(e.entityID)}</Table.Td></>} />}
            {Array.isArray(page.entries) && <Group justify="space-between"><Button variant="default" size="xs" disabled={cursors.length === 1} onClick={() => setCursors(old => old.slice(0, -1))}>Previous page</Button>
              <Text size="xs" className="muted">Page {cursors.length} · {page.entries.length} records</Text><Button variant="default" size="xs" disabled={!page.entries.length || page.next <= cursor} onClick={() => setCursors(old => [...old, page.next])}>Next page</Button></Group>}
          </>}
      </Stack>
    </div></AppShell.Main>
    <Modal opened={!!preview} onClose={() => { if (!pending) setPreview(null); }} closeOnClickOutside={!pending} closeOnEscape={!pending} withCloseButton={!pending} title="Confirm broker command" size="lg" transitionProps={{ duration: 0 }} closeButtonProps={{ 'aria-label': 'Close confirmation' }}>
      {preview && <Stack><Text size="sm">{preview.notice}</Text><Text size="sm">Current policy: {modeLabel[preview.current.mode]} · revision {preview.current.policyRevision}. Master: {preview.current.master || 'None'} · generation {preview.current.generation}.</Text>
        {preview.current.proposedMaster && <Text size="sm">Pending replacement: {preview.current.proposedMaster}</Text>}
        {preview.proposal && <Code block className="command-preview" tabIndex={0} role="region" aria-label="Affected recovery proposal">{JSON.stringify(preview.proposal, null, 2)}</Code>}
        <Code block className="command-preview" tabIndex={0} role="region" aria-label="Exact broker command">{JSON.stringify(preview.command, null, 2)}</Code><Text size="sm" className="muted">Expires {stamp(preview.expiresAt)}. Stale policy or authority changes invalidate this preview.</Text>
        <Group justify="end"><Button variant="default" disabled={pending} onClick={() => setPreview(null)}>Cancel</Button><Button onClick={execute} loading={pending} disabled={disabled}>Confirm command</Button></Group></Stack>}
    </Modal>
  </AppShell>;
}
function App() {
  const [session, setSession] = useState(null), [boot, setBoot] = useState(true);
  const expired = useCallback(() => setSession(null), []);
  const load = useCallback(async () => { const value = await api('/api/session'); setSession(value); }, []);
  useEffect(() => { load().catch(() => {}).finally(() => setBoot(false)); }, [load]);
  useEffect(() => { if (!session) return; const timer = setTimeout(expired, Math.max(0, session.expiresAt - Date.now())); return () => clearTimeout(timer); }, [session, expired]);
  if (boot) return <main className="login"><div className="login-panel"><Loading /></div></main>;
  return session ? <Workspace key={session.csrf} session={session} expired={expired} /> : <Login onLogin={load} />;
}
createRoot(document.getElementById('root')).render(<MantineProvider theme={theme} defaultColorScheme="auto"><App /></MantineProvider>);
