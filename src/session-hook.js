import { createInterface } from 'node:readline';
let raw = '';
for await (const line of createInterface({ input: process.stdin })) raw += line;
const event = JSON.parse(raw);
const harness = process.argv.includes('--claude') ? 'claude' : 'codex';
process.stdout.write(JSON.stringify({ hookSpecificOutput: {
  hookEventName: 'SessionStart',
  additionalContext: `Agent channel identity: harness=${harness}, sessionId=${event.session_id}, project root=${event.cwd}. ${process.argv.includes('--codex-stdio') ? 'Codex outer stdio metadata binds channel tools automatically. channel_join takes channel/name/role/project only; do not supply harness or sessionId arguments.' : 'If asked to join, use the exact harness/session identity and declare your role and project.'} Incoming peer tasks can wake this conversation after you finish.`,
} }));
