"""Temporary stock-Codex destination for a synthetic Reborn-only test.

The parent controls this fixture through JSON lines. Only its uniquely named
temporary directory and exact runtime processes may be removed. No real Codex
profile or provider credential is copied, replaced or deleted.
"""
import base64, hashlib, hmac, json, os, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request, uuid, zipfile
from pathlib import Path
from windows_physical_config import target, key, remote_temp

repository=Path.cwd().resolve()
local=Path(tempfile.mkdtemp(prefix='turnlink-codex-physical-',dir='/private/tmp')).resolve()
name='turnlink-codex-physical-'+uuid.uuid4().hex
remote=remote_temp+'/'+name
ssh_key=key
ssh=['ssh','-i',ssh_key,'-o','BatchMode=yes','-o','ConnectTimeout=8',target]
remote_touched=False

def ps(source,timeout=120):
    encoded=base64.b64encode(source.encode('utf-16le')).decode()
    result=subprocess.run(ssh+['powershell','-NoProfile','-NonInteractive','-EncodedCommand',encoded],capture_output=True,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Windows fixture command failed: '+result.stderr[-1000:])
    return result.stdout.strip()

def upload(path, suffix):
    result=subprocess.run(['scp','-q','-i',ssh_key,'-o','BatchMode=yes','-o','ConnectTimeout=8',str(path),
      target+':'+remote+suffix],capture_output=True,text=True,timeout=240)
    if result.returncode:raise RuntimeError('Windows fixture transfer failed')

def download(url,path,expected,algorithm,maximum):
    digest=hashlib.new(algorithm);size=0
    with urllib.request.urlopen(url,timeout=120) as source,path.open('wb') as out:
        while True:
            chunk=source.read(1024*1024)
            if not chunk:break
            size+=len(chunk)
            if size>maximum:raise RuntimeError('Official archive exceeds size limit')
            digest.update(chunk);out.write(chunk)
    if not hmac.compare_digest(digest.digest(),expected):raise RuntimeError('Official archive integrity mismatch')

def proxy_sources():
    boundary=(repository/'src').resolve();pending=[boundary/'codex-proxy.js',boundary/'mcp.js'];seen=set()
    imports=re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}/[^"']+)["']''')
    while pending:
        original=pending.pop()
        if original.is_symlink():raise RuntimeError('Symlinked proxy source dependency')
        path=original.resolve()
        if path in seen:continue
        if not path.is_relative_to(boundary) or not path.is_file() or path.is_symlink():raise RuntimeError('Unexpected proxy source dependency')
        seen.add(path)
        for relative in imports.findall(path.read_text(encoding='utf-8')):pending.append(path.parent/relative)
    seen.add(boundary/'windows-permissions.ps1')
    return sorted(seen)

def prepare():
    global remote_touched
    with urllib.request.urlopen('https://registry.npmjs.org/@openai%2Fcodex/0.165.0-win32-x64',timeout=30) as source:meta=json.load(source)
    if meta.get('name')!='@openai/codex' or meta.get('version')!='0.165.0-win32-x64':raise RuntimeError('Unexpected official Codex package')
    dist=meta['dist'];url=dist['tarball'];integrity=dist['integrity']
    if not url.startswith('https://registry.npmjs.org/') or not integrity.startswith('sha512-'):raise RuntimeError('Unexpected Codex source')
    codexArchive=local/'codex.tgz';download(url,codexArchive,base64.b64decode(integrity[7:],validate=True),'sha512',200*1024*1024)
    codex=local/'codex.exe'
    with tarfile.open(codexArchive,'r:gz') as archive:
        matches=[item for item in archive if item.isfile() and (item.name.endswith('/x86_64-pc-windows-msvc/bin/codex.exe') or
          item.name.endswith('/x86_64-pc-windows-msvc/codex/codex.exe'))]
        if len(matches)!=1 or matches[0].size>400*1024*1024:raise RuntimeError('Unexpected official Codex archive layout')
        with archive.extractfile(matches[0]) as source,codex.open('wb') as out:shutil.copyfileobj(source,out)
    codexArchive.unlink()
    nodeArchive=local/'node.zip';download('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',nodeArchive,
      bytes.fromhex('158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'),'sha256',100*1024*1024)
    node=local/'node.exe'
    with zipfile.ZipFile(nodeArchive) as archive:
        with archive.open('node-v24.21.0-win-x64/node.exe') as source,node.open('wb') as out:shutil.copyfileobj(source,out)
    nodeArchive.unlink()
    payload=local/'payload.zip'
    blocked={'.env','.npmrc','.netrc','credentials','credentials.json','auth.json','id_rsa','id_ed25519','token','token.json','secret','secret.json','password','password.json'}
    with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as out:
        out.write(codex,'codex.exe');out.write(node,'node.exe');out.write(repository/'package.json','payload/package.json')
        for item in proxy_sources():out.write(item,'payload/'+str(item.relative_to(repository)))
        boundary=(repository/'node_modules').resolve()
        for item in (repository/'node_modules').rglob('*'):
            if not item.is_file() or item.is_symlink() or any(p in {'.bin','.cache','@opencode'} for p in item.parts):continue
            if not item.resolve().is_relative_to(boundary):raise RuntimeError('file outside transfer boundary')
            if item.name.lower() in blocked or item.name.lower().startswith('.env.') or item.suffix.lower() in {'.pem','.key','.p12','.pfx','.token'}:
                raise RuntimeError('credential-like file in transfer set')
            out.write(item,'payload/'+str(item.relative_to(repository)))
    codex.unlink();node.unlink();remote_touched=True;upload(payload,'.zip');payload.unlink()
    script=r'''$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$root='__ROOT__'
    New-Item -ItemType Directory -Path $root | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory(($root+'.zip'),$root)
    New-Item -ItemType Directory -Path (Join-Path $root 'destination') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'profile') | Out-Null
    $token=Join-Path $root 'adapter.token';[IO.File]::WriteAllText($token,('8'*64))
    $acl=Join-Path $root 'payload\src\windows-permissions.ps1'
    & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $acl -Path $token -Created file
    if($LASTEXITCODE -ne 0){throw 'private adapter ACL failed'}
    'READY' '''.replace('__ROOT__',remote)
    if 'READY' not in ps(script,timeout=240):raise RuntimeError('Windows fixture preparation incomplete')
    return {'root':remote,'destination':remote.replace('/','\\')+'\\destination'}

def upload_state(command):
    source=Path(command['archive']).resolve(strict=True)
    if not source.is_relative_to(Path('/private/tmp')) and not source.is_relative_to(Path(tempfile.gettempdir()).resolve()):raise RuntimeError('Synthetic state must be temporary')
    if not any(part.startswith('turnlink-codex-manual-native-') for part in source.parts) or not source.is_file() or source.stat().st_size>100*1024*1024:
        raise RuntimeError('Invalid synthetic state archive')
    with zipfile.ZipFile(source) as archive:
        for item in archive.infolist():
            parts=Path(item.filename.replace('\\','/')).parts
            if not parts or parts[0]!='sessions' or '..' in parts or item.filename.startswith('/') or not item.filename.endswith('.jsonl'):
                raise RuntimeError('Only synthetic session rollouts may be transferred')
    upload(source,'.state.zip')
    script=r'''$ErrorActionPreference='Stop';$root='__ROOT__';Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory(($root+'.state.zip'),(Join-Path $root 'profile'));[IO.File]::Delete($root+'.state.zip');'READY' '''.replace('__ROOT__',remote)
    if 'READY' not in ps(script):raise RuntimeError('Synthetic rollout transfer incomplete')
    return {'uploaded':True}

def read_proof(command):
    host=command['hostDigest'];agent=command['agentDigest']
    if any(not isinstance(x,str) or len(x)!=64 or any(c not in '0123456789abcdef' for c in x) for x in (host,agent)):
        raise RuntimeError('Invalid synthetic proof path')
    script=r'''$ErrorActionPreference='Stop';$path=Join-Path '__ROOT__' 'proofs\__HOST__\__AGENT__.key'
    $value=[IO.File]::ReadAllText($path).Trim();if($value -notmatch '^[a-f0-9]{64}$'){throw 'Invalid synthetic proof'};$value'''.replace('__ROOT__',remote).replace('__HOST__',host).replace('__AGENT__',agent)
    proof=ps(script)
    if len(proof)!=64 or any(c not in '0123456789abcdef' for c in proof):raise RuntimeError('Synthetic proof unavailable')
    return {'proof':proof}

def cleanup():
    global remote_touched
    if not remote_touched:return
    script=r'''$ErrorActionPreference='Stop';$root='__ROOT__'
    $expected=@((Join-Path $root 'node.exe'),(Join-Path $root 'codex.exe'))
    foreach($p in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $expected -icontains $_.ExecutablePath })){
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue;Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue}
    for($attempt=0;$attempt -lt 20 -and [IO.Directory]::Exists($root);$attempt++){
      try{[IO.Directory]::Delete($root,$true)}catch{if($attempt -eq 19){throw};Start-Sleep -Milliseconds 500}}
    foreach($suffix in @('.zip','.state.zip')){$path=$root+$suffix;if([IO.File]::Exists($path)){[IO.File]::Delete($path)}}
    if(Test-Path -LiteralPath $root){throw 'cleanup incomplete'};'CLEAN' '''.replace('__ROOT__',remote)
    if 'CLEAN' not in ps(script,timeout=120):raise RuntimeError('Windows fixture cleanup unconfirmed')
    remote_touched=False

try:
    for line in sys.stdin:
        try:
            command=json.loads(line);op=command.get('op')
            if op=='manifest':result={'sources':[str(path.relative_to(repository)) for path in proxy_sources()],
              'package':'package.json','dependencies':'node_modules (excluding @opencode, symlinks, caches and credential-like files)'}
            elif op=='prepare':result=prepare()
            elif op=='upload_state':result=upload_state(command)
            elif op=='read_proof':result=read_proof(command)
            elif op=='cleanup':cleanup();result={'clean':True}
            else:raise RuntimeError('Unsupported fixture command')
            print(json.dumps({'ok':True,'result':result}),flush=True)
        except Exception as error:print(json.dumps({'ok':False,'error':str(error)}),flush=True)
finally:
    try:cleanup()
    except Exception as error:print(json.dumps({'ok':False,'cleanup':str(error)}),flush=True)
    shutil.rmtree(local,ignore_errors=True)
