"""Run a synthetic Codex/MCP/broker test in a temporary offline container."""
import base64, hashlib, hmac, json, os, shutil, subprocess, tarfile, tempfile, urllib.request, uuid
from pathlib import Path

repo=Path.cwd().resolve();root=Path(tempfile.mkdtemp(prefix='turnlink-codex-agent-',dir='/private/tmp')).resolve()
name='turnlink-codex-agent-'+uuid.uuid4().hex

def official(package,version,member,destination):
    with urllib.request.urlopen(f'https://registry.npmjs.org/{package}/{version}',timeout=20) as response:meta=json.load(response)
    if meta['name']!=package.replace('%2F','/') or meta['version']!=version:raise RuntimeError('unexpected official package')
    info=meta['dist'];uri=info['tarball'];integrity=info['integrity']
    if not uri.startswith('https://registry.npmjs.org/') or not integrity.startswith('sha512-'):raise RuntimeError('unexpected official distribution')
    expected=base64.b64decode(integrity[7:],validate=True);digest=hashlib.sha512();size=0;archive=root/(destination+'.tgz')
    with urllib.request.urlopen(uri,timeout=60) as source,archive.open('wb') as out:
        while True:
            data=source.read(1024*1024)
            if not data:break
            size+=len(data)
            if size>200*1024*1024:raise RuntimeError('official archive exceeds size limit')
            digest.update(data);out.write(data)
    if len(expected)!=64 or not hmac.compare_digest(digest.digest(),expected):raise RuntimeError('official package integrity mismatch')
    with tarfile.open(archive,'r:gz') as package_file:
        matches=[entry for entry in package_file if entry.isfile() and entry.name==member]
        if len(matches)!=1 or matches[0].size>350*1024*1024:raise RuntimeError('unexpected official package structure')
        with package_file.extractfile(matches[0]) as source,(root/destination).open('wb') as out:shutil.copyfileobj(source,out)
    (root/destination).chmod(0o700);archive.unlink()

try:
    official('@openai%2Fcodex','0.165.0-linux-arm64','package/vendor/aarch64-unknown-linux-musl/bin/codex','codex')
    official('node-linux-arm64','24.21.0','package/bin/node','node')
    docker=shutil.which('docker')
    if not docker:raise RuntimeError('Docker is required')
    command=[docker,'run','--name',name,'--rm','--pull','never','--network','none','--read-only','--tmpfs','/root:mode=0700',
      '--tmpfs','/tmp:mode=1777','--tmpfs','/workspace:mode=0700','--cap-drop','ALL','--security-opt','no-new-privileges',
      '--pids-limit','128','--memory','1g','--mount',f'type=bind,src={repo},dst=/repo,readonly',
      '--mount',f'type=bind,src={root}/codex,dst=/tool/codex,readonly','--mount',f'type=bind,src={root}/node,dst=/tool/node,readonly',
      '--workdir','/repo','-e','TURNLINK_OFFLINE_CODEX_AGENT=1','-e','TURNLINK_FIXTURE_KEY=local-fixture-only',
      '--entrypoint','/bin/sh','rust:1.99.1','-c','python3 /repo/test/fixtures/codex-agent-model.py & exec /tool/node --test test/codex-native-agent-manual.test.js']
    result=subprocess.run(command,timeout=180)
    if result.returncode:raise RuntimeError('offline Codex agent test failed')
finally:
    docker=shutil.which('docker')
    if docker:subprocess.run([docker,'rm','-f',name],capture_output=True,text=True,timeout=15)
    shutil.rmtree(root,ignore_errors=True)
