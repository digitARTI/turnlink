import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { privateTemp } from '../src/storage.js';

const enabled = process.env.TURNLINK_MINIMAL_VM_PROBE === '1';
test('isolated minimal Linux guest from cached local components', { skip: process.platform !== 'darwin' || !enabled, timeout: 60000 }, t => {
  const root = privateTemp('/private/tmp/turnlink-minimal-vm-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'buffer', timeout: 30000, maxBuffer: 24 * 1024 * 1024, ...options });
    assert.equal(result.status, 0, String(result.stderr)); return result.stdout;
  };
  const docker = '/opt/homebrew/bin/docker', archive = join(root, 'alpine.tar'), layer = join(root, 'layer.tar'), guest = join(root, 'guest');
  // docker image save is read-only: the cached image and existing context are unchanged.
  run(docker, ['image', 'save', '--output', archive, 'alpine:3.21']);
  const manifest = JSON.parse(run('/usr/bin/tar', ['-xOf', archive, 'manifest.json']).toString());
  assert.equal(manifest.length, 1); assert.equal(manifest[0].Layers.length, 1);
  assert.match(manifest[0].Layers[0], /^blobs\/sha256\/[a-f0-9]{64}$/);
  writeFileSync(layer, run('/usr/bin/tar', ['-xOf', archive, manifest[0].Layers[0]]), { mode: 0o600 });
  for (const name of ['bin', 'lib', 'dev', 'proc', 'sys']) mkdirSync(join(guest, name), { recursive: true, mode: 0o700 });
  run('/usr/bin/tar', ['--no-same-owner', '-xf', layer, '-C', guest, 'bin/busybox', 'lib/ld-musl-aarch64.so.1', 'lib/libc.musl-aarch64.so.1']);
  const init = join(guest, 'init'); writeFileSync(init, '#!/bin/busybox sh\n/bin/busybox mount -t devtmpfs devtmpfs /dev\nexec </dev/console >/dev/console 2>&1\necho TURNLINK_MINIMAL_GUEST_READY\n/bin/busybox sleep 30\n'); chmodSync(init, 0o755);
  const paths = run('/usr/bin/find', ['.', '-print'], { cwd: guest });
  const cpio = run('/usr/bin/cpio', ['-o', '-H', 'newc'], { cwd: guest, input: paths });
  const initrd = join(root, 'initramfs.gz'); writeFileSync(initrd, gzipSync(cpio), { mode: 0o600 });
  const binary = join(root, 'probe'), cache = process.env.TURNLINK_VM_SWIFT_CACHE || join(root, 'cache');
  run('/usr/bin/swiftc', ['-module-cache-path', cache, resolve('test/fixtures/codex-minimal-guest-probe.swift'), '-o', binary]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), binary]);
  const output = run(binary, ['/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/nerdbox-kernel-arm64', initrd]).toString();
  assert.match(output, /configuration_valid=true/); assert.match(output, /start=success/); assert.match(output, /guest=ready/);
});
