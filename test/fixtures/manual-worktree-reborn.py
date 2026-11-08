#!/usr/bin/env python3
"""Opt-in, synthetic-only Windows verification; no runtime is installed."""
import base64
from contextlib import nullcontext
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import uuid
import zipfile
from windows_physical_config import target, key, remote_temp

REPOSITORY = Path(__file__).resolve().parents[2]
KEY = key
SSH = ['ssh', '-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', target]
REMOTE_NAME = 'turnlink-managed-test-' + uuid.uuid4().hex
REMOTE = remote_temp + '/' + REMOTE_NAME
PACKAGES = ['zod', 'ws', 'proper-lockfile', 'graceful-fs', 'retry', 'signal-exit', 'jsonc-parser', 'smol-toml']


def powershell(script, timeout=180):
    encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
    result = subprocess.run(SSH + ['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Remote fixture failed: ' + result.stdout[-9000:] + '\n' + result.stderr[-2500:])
    return result.stdout


def download(url, path, expected, limit):
    checksum = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=90) as source, path.open('wb') as target:
        size = 0
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise RuntimeError('Official archive exceeds limit')
            checksum.update(chunk)
            target.write(chunk)
    if checksum.hexdigest() != expected:
        raise RuntimeError('Official archive SHA-256 mismatch')


def add_files(archive, directory, prefix):
    root = directory.resolve(strict=True)
    blocked = {'.env', '.npmrc', '.netrc', 'credentials', 'credentials.json', 'auth.json', 'id_rsa', 'id_ed25519', 'token', 'token.json'}
    for path in directory.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        if not path.resolve().is_relative_to(root):
            raise RuntimeError('Unexpected test payload path')
        if path.name.lower() in blocked or path.name.lower().startswith('.env.') or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.token'}:
            raise RuntimeError('Credential-like file refused from test payload')
        destination = prefix + '/' + str(path.relative_to(directory)).replace(os.sep, '/')
        if destination == 'project/src/manual-managed-worktree.js':
            # The payload contains only synthetic paths and credentials. Show
            # the underlying error only in this isolated test copy.
            source = path.read_text(encoding='utf-8')
            needle = "} catch (error) {\n  console.error(`Manual managed worktree failed"
            if source.count(needle) != 1:
                raise RuntimeError('Fixture diagnostic insertion point changed')
            archive.writestr(destination, source.replace(needle, "} catch (error) {\n  console.error('FIXTURE_DETAIL:', error.stack);\n  console.error(`Manual managed worktree failed"))
        elif destination == 'project/src/worktree-lifecycle.js':
            source = path.read_text(encoding='utf-8')
            needle = "} catch { throw new Error('WORKTREE_GIT_OPERATION_FAILED'); }"
            if source.count(needle) != 1:
                raise RuntimeError('Fixture Git diagnostic insertion point changed')
            source = source.replace(needle, "} catch (error) { console.error('FIXTURE_GIT:', error.message, String(error.stderr || '')); throw new Error('WORKTREE_GIT_OPERATION_FAILED'); }")
            archive.writestr(destination, source)
        else:
            archive.write(path, destination)


def main():
    remote_touched = False
    cached = os.environ.get('TURNLINK_MANAGED_FIXTURE_CACHE')
    if cached:
        cache_path = Path(cached).resolve(strict=True)
        if not (cache_path.is_relative_to(Path(tempfile.gettempdir()).resolve()) or cache_path.is_relative_to(Path('/private/tmp'))) or not cache_path.name.startswith('turnlink-manual-managed-cache-'):
            raise RuntimeError('Unsafe fixture cache path')
    with (nullcontext(str(cache_path)) if cached else tempfile.TemporaryDirectory(prefix='turnlink-manual-managed-reborn-')) as temp:
        root = Path(temp)
        node_zip, git_zip, payload = root / 'node.zip', root / 'git.zip', root / 'payload.zip'
        for url, path, expected in [
            ('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip', node_zip, '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'),
            ('https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-2.56.0.4-64-bit.zip', git_zip, 'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877'),
        ]:
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                download(url, path, expected, 100 * 1024 * 1024)
        with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            archive.write(REPOSITORY / 'package.json', 'project/package.json')
            archive.write(REPOSITORY / 'test/manual-managed-worktree.test.js', 'project/test/manual-managed-worktree.test.js')
            archive.write(REPOSITORY / 'adapters/opencode-tasks.js', 'project/adapters/opencode-tasks.js')
            add_files(archive, REPOSITORY / 'src', 'project/src')
            for package in PACKAGES:
                add_files(archive, REPOSITORY / 'node_modules' / package, 'project/node_modules/' + package)
        try:
            for path, suffix in [(node_zip, '.node.zip'), (git_zip, '.git.zip'), (payload, '.payload.zip')]:
                remote_touched = True
                subprocess.run(['scp', '-q', '-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                                str(path), target + ':' + REMOTE + suffix], check=True, timeout=240)
            setup = r'''$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$root='__ROOT__'
if(Test-Path -LiteralPath $root){throw 'Test root already exists'}
New-Item -ItemType Directory -Path $root | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory(($root+'.node.zip'),$root)
[IO.Compression.ZipFile]::ExtractToDirectory(($root+'.git.zip'),($root+'/git'))
[IO.Compression.ZipFile]::ExtractToDirectory(($root+'.payload.zip'),$root)
New-Item -ItemType Directory -Path ($root+'/temp'),($root+'/home') | Out-Null
$env:TEMP=$root+'/temp';$env:TMP=$root+'/temp';$env:USERPROFILE=$root+'/home';$env:HOME=$root+'/home'
$env:APPDATA=$root+'/home';$env:LOCALAPPDATA=$root+'/home'
$env:PATH=($root+'/git/cmd')+';'+($root+'/node-v24.21.0-win-x64')+';'+$env:SystemRoot+'\System32;'+$env:SystemRoot
Set-Location ($root+'/project')
& ($root+'/node-v24.21.0-win-x64/node.exe') --test test/manual-managed-worktree.test.js
if($LASTEXITCODE -ne 0){throw ('Test exit '+$LASTEXITCODE)}
'REBORn_MANAGED_TEST_PASSED' '''.replace('__ROOT__', REMOTE)
            output = powershell(setup, timeout=240)
            if 'REBORn_MANAGED_TEST_PASSED' not in output:
                raise RuntimeError('Windows test completion marker missing')
            print(output, flush=True)
        finally:
            if remote_touched:
                cleanup = r'''$ErrorActionPreference='Stop';$root='__ROOT__'
$nativeRoot=$root.Replace('/','\')
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($nativeRoot,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
foreach($path in @($root,($root+'.node.zip'),($root+'.git.zip'),($root+'.payload.zip'))) { if(Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }; if(Test-Path -LiteralPath $path) { throw 'Temporary fixture remains' } }
'REBORn_MANAGED_CLEAN' '''.replace('__ROOT__', REMOTE)
                if 'REBORn_MANAGED_CLEAN' not in powershell(cleanup, timeout=120):
                    raise RuntimeError('Windows fixture cleanup not confirmed')
                print('REBORn_MANAGED_CLEAN', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
