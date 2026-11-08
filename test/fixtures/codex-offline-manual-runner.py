"""Run the native manual-proxy test with an unmodified offline Codex binary.

Requires an existing Docker daemon and rust:1.99.1 image. Only an official
binary and a synthetic loopback model enter the network-disabled containers.
"""
import base64, hashlib, hmac, json, os, shlex, shutil, subprocess, tarfile, tempfile, urllib.request, uuid
from pathlib import Path

repo=Path.cwd().resolve()
root=Path(tempfile.mkdtemp(prefix='turnlink-codex-official-',dir='/private/tmp')).resolve()
prefix='turnlink-codex-manual-'+uuid.uuid4().hex
try:
    with urllib.request.urlopen('https://registry.npmjs.org/@openai%2Fcodex/0.165.0-linux-arm64',timeout=20) as response:
        meta=json.load(response)
    if meta['name']!='@openai/codex' or meta['version']!='0.165.0-linux-arm64':raise RuntimeError('unexpected official package')
    distribution=meta['dist'];uri=distribution['tarball'];integrity=distribution['integrity']
    if not uri.startswith('https://registry.npmjs.org/') or not integrity.startswith('sha512-'):raise RuntimeError('unexpected official distribution')
    expected=base64.b64decode(integrity[7:],validate=True)
    if len(expected)!=64:raise RuntimeError('invalid official package integrity')
    archive=root/'official.tgz';digest=hashlib.sha512();total=0
    with urllib.request.urlopen(uri,timeout=60) as source,archive.open('wb') as out:
        while True:
            data=source.read(1024*1024)
            if not data:break
            total+=len(data)
            if total>200*1024*1024:raise RuntimeError('official archive exceeds size limit')
            digest.update(data);out.write(data)
    if not hmac.compare_digest(digest.digest(),expected):raise RuntimeError('official package integrity mismatch')
    with tarfile.open(archive,'r:gz') as package:
        matches=[entry for entry in package if entry.isfile() and entry.name=='package/vendor/aarch64-unknown-linux-musl/bin/codex']
        if len(matches)!=1 or matches[0].size>350*1024*1024:raise RuntimeError('unexpected official package structure')
        binary=root/'codex'
        with package.extractfile(matches[0]) as source,binary.open('wb') as out:shutil.copyfileobj(source,out)
    binary.chmod(0o700);archive.unlink()
    docker=shutil.which('docker');node=shutil.which('node')
    if not docker or not node:raise RuntimeError('Docker and Node are required')
    host=subprocess.run([docker,'context','inspect','--format','{{.Endpoints.docker.Host}}'],capture_output=True,text=True,check=True,timeout=15).stdout.strip()
    if not host.startswith('unix://'):raise RuntimeError('a local Docker daemon is required')
    config=root/'docker-config';config.mkdir();wrapper=root/'isolated-codex'
    command=[docker,'--config',str(config),'--host',host,'run','--rm','--pull','never','--network','none','--read-only',
      '--tmpfs','/root:mode=0700','--tmpfs','/tmp:mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','-i']
    script=('#!/bin/sh\nexec '+' '.join(shlex.quote(part) for part in command)+' --name '+shlex.quote(prefix)+'-$$ '
      '--mount type=bind,src="${TURNLINK_NATIVE_TEST_ROOT}/codex",dst=/root/.codex '
      '--mount type=bind,src="${TURNLINK_NATIVE_TEST_ROOT}/workspaces",dst=/workspace '
      '--mount '+shlex.quote(f'type=bind,src={binary},dst=/tool/codex,readonly')+' '
      '--mount '+shlex.quote(f'type=bind,src={repo}/test/fixtures/codex-offline-model.py,dst=/tool/model.py,readonly')+' '
      '-e TURNLINK_FIXTURE_KEY=local-fixture-only --entrypoint /bin/sh rust:1.99.1 '
      +shlex.quote('-c')+' '+shlex.quote('python3 /tool/model.py & exec /tool/codex "$@"')+' fixture "$@"\n')
    wrapper.write_text(script);wrapper.chmod(0o700)
    env=os.environ.copy();env['TURNLINK_OFFLINE_CODEX_EXECUTABLE']=str(wrapper)
    result=subprocess.run([node,'--test','test/codex-native-manual-proxy.test.js'],cwd=repo,env=env,timeout=135)
    if result.returncode:raise RuntimeError('offline native manual test failed')
finally:
    docker=shutil.which('docker')
    if docker:
        ids=subprocess.run([docker,'ps','-aq','--filter','name='+prefix],capture_output=True,text=True,timeout=15).stdout.splitlines()
        if ids:subprocess.run([docker,'rm','-f']+ids,capture_output=True,text=True,timeout=15)
    shutil.rmtree(root,ignore_errors=True)
