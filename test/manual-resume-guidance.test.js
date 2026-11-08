import test from 'node:test';
import assert from 'node:assert/strict';
import { manualResumeGuidance } from '../src/manual-resume-guidance.js';

test('manual guidance distinguishes required operator actions without granting authority', () => {
  const base = { sourceRecord: { work: 'pending work' }, status: 'detached', connected: true, location: '/destination', to: '/destination' };
  assert.equal(manualResumeGuidance({ ...base, sourceRecord: null }).step, 'restore_record');
  assert.equal(manualResumeGuidance({ ...base, status: 'uncertain' }).step, 'recover_source');
  assert.equal(manualResumeGuidance({ ...base, status: 'armed' }).step, 'stop_source');
  assert.equal(manualResumeGuidance({ ...base, connected: false, hostTransfer: { status: 'pending' } }).step, 'resume_destination');
  assert.equal(manualResumeGuidance({ ...base, location: '/wrong' }).step, 'inspect_location');
  assert.equal(manualResumeGuidance({ ...base, report: { status: 'incomplete' } }).step, 'resolve_comparison');
  assert.equal(manualResumeGuidance({ ...base, report: { status: 'awaiting_report' } }).step, 'await_comparison');
  assert.equal(manualResumeGuidance({ ...base, report: { status: 'reported_match' } }).step, 'confirm');
  assert.equal(manualResumeGuidance({ ...base, status: 'confirmed' }).step, 'await_task');
  assert.equal(manualResumeGuidance({ ...base, status: 'uncertain', connected: false, hostTransferAttemptsExhausted: true }).step, 'recover_source');
  assert.equal(manualResumeGuidance({ ...base, status: 'armed', connected: true, location: '/source', from: '/source', hostTransferAttemptsExhausted: true }).step, 'reset_preview');
});
