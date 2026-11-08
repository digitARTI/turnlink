import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { AdmissionLedger } from './admissions.js';
import { createOpenCodePluginCapabilityHost } from './opencode-plugin-capability-host.js';
import { createOpenCodePluginOwnerPrompt } from './opencode-plugin-owner-prompt.js';
import { createOpenCodePluginParticipantBroker } from './opencode-plugin-participant-broker.js';
import { createOpenCodePluginStreamPort } from './opencode-plugin-stream-port.js';
import { inspectOpenCodeDaemonLaunch } from './opencode-plugin-daemon-launch.js';
import { observeOpenCodePluginSeal } from './opencode-plugin-seal-observer.js';
import { holdOpenCodePluginProvenance } from './opencode-plugin-held-lease.js';

// Owner-side bootstrap only. Membership policy and broker credentials remain
// with the caller. This does not confer worktree or daemon custody authority.
export async function startOpenCodePluginOwnerBridge({ context, channel, sessionID, launch, childDirectory, journalDirectory,
  authorizeMembership, allowedChannel, allowTestSubscribe = false, allowParticipantControl = false }) {
  const directory = context?.location?.directory, child = launch?.child;
  if (!directory?.startsWith('/') || !sessionID?.startsWith('ses_') || !childDirectory?.startsWith('/') ||
      !journalDirectory?.startsWith('/') || typeof authorizeMembership !== 'function') throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
  const info = inspectOpenCodeDaemonLaunch(launch, child);
  if (info.sessionID !== sessionID || info.directory !== directory) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
  await channel.connect();
  const broker = createOpenCodePluginParticipantBroker({ channel, sessionID, directory, allowedChannel, allowTestSubscribe, allowParticipantControl });
  const admitPrompt = createOpenCodePluginOwnerPrompt({ broker, context, sessionID, directory, hostId: channel.hostId, journalDirectory });
  broker.setAckVerifier(admitPrompt.mayAck);
  const ledger = new AdmissionLedger(channel.hostId, `opencode:${sessionID}`, childDirectory);
  const port = createOpenCodePluginStreamPort({ input: child.stdout, output: child.stdin, child });
  const capabilityHost = createOpenCodePluginCapabilityHost({ port, context, sessionID, participantBroker: broker, childLedger: ledger,
    allowTools: true, allowControlTools: allowParticipantControl, authorizeMembership, admitPrompt,
    activityEvidence: () => admitPrompt.isClear() && broker.isQuiet() });
  const lines = createInterface({ input: child.stderr }), exited = once(child, 'exit');
  let closed = false, closing;
  const close = () => {
    if (closing) return closing;
    closed = true;
    let resolveClose, rejectClose;
    closing = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
    void (async () => {
      try { capabilityHost.close(); }
      finally {
        // A Docker CLI can trap SIGTERM while waiting for the guest.
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        try { await exited; } finally { lines.close(); }
      }
    })().then(resolveClose, rejectClose);
    return closing;
  };
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Unavailable')), 10000); });
    const [ready] = await Promise.race([once(lines, 'line'), exited.then(() => { throw new Error('Unavailable'); }), timeout]);
    if (ready !== 'ready') throw new Error('Unavailable');
    inspectOpenCodeDaemonLaunch(launch, child);
    const holdProvenance = ({ native, watchAuthority, daemonID, containerID, bundleSha256, guardSha256, signal, ackHashProbe }) => {
      if (closed) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
      const observeSeal = () => observeOpenCodePluginSeal({ docker: info.docker, containerID, image: info.image, bundleSha256, guardSha256,
        sessionID, directory, child, launch, port, signal, ackHashProbe });
      return holdOpenCodePluginProvenance({ native, capabilityHost, observeSeal, watchAuthority, daemonID, port, signal });
    };
    return Object.freeze({ capabilityHost, broker, port, launch, holdProvenance, close });
  } catch { await close().catch(() => {}); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
  finally { clearTimeout(timer); }
}
