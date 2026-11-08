export const initialTaskForm = Object.freeze({ title: '', instructions: '', criteria: '', dependencies: '', priority: '50',
  scheduledAt: '', missed: 'ask', maxLatenessSeconds: '5', deadlineAt: '', progressTimeoutSeconds: '300' });

// UTC is explicit: browser-local DST gaps/overlaps must never silently shift a
// requested schedule. Reject Date's normalization of impossible calendar dates.
function utcMinute(value, label) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error(`${label} must be a UTC date and time.`);
  const at = Date.parse(`${value}:00.000Z`);
  if (!Number.isSafeInteger(at) || at < 0 || new Date(at).toISOString().slice(0, 16) !== value)
    throw new Error(`${label} must be a valid UTC date and time after the Unix epoch.`);
  return at;
}
function integer(value, minimum, maximum, label) {
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum)
    throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  return Number(value);
}

// Presentation validation only; the broker schema, current channel, dependency
// inventory and deadline checks remain authoritative at commit.
export function taskFields(form) {
  const dependencies = form.dependencies.trim() ? form.dependencies.trim().split(/[\s,]+/) : [];
  if (dependencies.length > 64 || new Set(dependencies).size !== dependencies.length)
    throw new Error('Use at most 64 distinct dependency task IDs.');
  const at = utcMinute(form.scheduledAt, 'Scheduled start'), deadlineAt = utcMinute(form.deadlineAt, 'Deadline');
  if (!['ask', 'skip', 'run_late'].includes(form.missed)) throw new Error('Choose a missed-schedule policy.');
  return { title: form.title, instructions: form.instructions, criteria: form.criteria, requiresWorktree: false, dependencies,
    priority: integer(form.priority, 0, 100, 'Priority'),
    progressTimeoutMs: integer(form.progressTimeoutSeconds, 1, 2592000, 'Progress timeout seconds') * 1000,
    ...(at === undefined ? {} : { schedule: { at, missed: form.missed,
      maxLatenessMs: integer(form.maxLatenessSeconds, 1, 2592000, 'Maximum lateness seconds') * 1000 } }),
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
  };
}
