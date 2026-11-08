"""Temporary, synthetic-only Windows endpoint for a physical-host migration test.

The parent sends one JSON command per line and owns a private test root.  No
existing user profile, application session, or provider credential is read.
"""
import base64, gzip, json, os, secrets, shutil, subprocess, sys, tempfile, uuid, zipfile
from pathlib import Path
from windows_physical_config import target, key, remote_temp

repository=Path.cwd().resolve()
local=Path(tempfile.mkdtemp(prefix='turnlink-physical-fixture-',dir='/private/tmp')).resolve()
name='turnlink-physical-'+uuid.uuid4().hex
remote=remote_temp+'/'+name
ssh_key=key
ssh=['ssh','-i',ssh_key,'-o','BatchMode=yes','-o','ConnectTimeout=8',target]
session=None
session_log=None
remote_touched=False

def ps(source,timeout=60):
    encoded=base64.b64encode(source.encode('utf-16le')).decode()
    result=subprocess.run(ssh+['powershell','-NoProfile','-NonInteractive','-EncodedCommand',encoded],capture_output=True,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Windows fixture command failed: '+result.stderr[-1000:])
    return result.stdout.strip()

def upload(path, filename):
    result=subprocess.run(['scp','-q','-i',ssh_key,'-o','BatchMode=yes','-o','ConnectTimeout=8',str(path),
        target+':'+remote_temp+'/'+filename],capture_output=True,text=True,timeout=180)
    if result.returncode:raise RuntimeError('Windows fixture transfer failed')

def prepare():
    global remote_touched
    archive=local/'payload.zip'
    blocked={'.env','.npmrc','.netrc','credentials','credentials.json','auth.json','id_rsa','id_ed25519','token','token.json','secret','secret.json','password','password.json'}
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as out:
        out.write(repository/'package.json','package.json')
        for part in ('src','adapters','node_modules'):
            boundary=(repository/part).resolve()
            for item in (repository/part).rglob('*'):
                if not item.is_file() or item.is_symlink() or '.bin' in item.parts or '.cache' in item.parts:continue
                if not item.resolve().is_relative_to(boundary):raise RuntimeError('file outside transfer boundary')
                if item.name.lower() in blocked or item.name.lower().startswith('.env.') or item.suffix.lower() in {'.pem','.key','.p12','.pfx','.token'}:
                    raise RuntimeError('credential-like file in transfer set')
                out.write(item,item.relative_to(repository))
    remote_touched=True
    upload(archive,name+'.zip');archive.unlink()
    script=r'''$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$root='__ROOT__';$zip='__ROOT__.zip'
    New-Item -ItemType Directory -Path $root | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,(Join-Path $root 'payload'))
    $runtime=Join-Path $root 'runtime.zip'
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 150 -Uri 'https://github.com/anomalyco/opencode/releases/download/v2.2.6/opencode-windows-x64.zip' -OutFile $runtime
    if((Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'f75c16b33b8523fe1ff41e7d97e3ae654a47d59a0e327def24db2d9291bb24be'){throw 'runtime hash mismatch'}
    [IO.Compression.ZipFile]::ExtractToDirectory($runtime,(Join-Path $root 'runtime'));[IO.File]::Delete($runtime)
    $nodeArchive=Join-Path $root 'node.zip'
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 150 -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile $nodeArchive
    if((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'){throw 'node hash mismatch'}
    [IO.Compression.ZipFile]::ExtractToDirectory($nodeArchive,(Join-Path $root 'node'));[IO.File]::Delete($nodeArchive)
    New-Item -ItemType Directory -Path (Join-Path $root 'destination') | Out-Null
    'READY' '''.replace('__ROOT__',remote)
    if 'READY' not in ps(script,timeout=300):raise RuntimeError('Windows fixture preparation incomplete')
    return {'root':remote,'destination':remote.replace('/','\\')+'\\destination'}

def start(command):
    global session,session_log
    if session and session.poll() is None:raise RuntimeError('Windows service already running')
    source=Path(command['stateArchive']).resolve(strict=True)
    temporary_roots=[Path('/private/tmp'),Path(tempfile.gettempdir()).resolve()]
    if not any(source.is_relative_to(parent) for parent in temporary_roots) or not any(part.startswith('turnlink-live-manual-') for part in source.parts) or not source.is_file() or source.stat().st_size>100*1024*1024:
        raise RuntimeError('synthetic state archive must be a bounded temporary file')
    with zipfile.ZipFile(source) as archive:
        for item in archive.infolist():
            parts=Path(item.filename.replace('\\','/')).parts
            if not parts or parts[0] not in {'config','data','cache','state','project'} or '..' in parts or item.filename.startswith('/'):
                raise RuntimeError('invalid synthetic state archive entry')
            if Path(item.filename).name.lower() in {'.env','auth.json','credentials','credentials.json','token','token.json'}:
                raise RuntimeError('credential-like synthetic state archive entry')
    ports={key:int(command[key]) for key in ('apiPort','brokerPort','modelPort','remoteApiPort','remoteBrokerPort','remoteModelPort')}
    if any(value<1024 or value>65535 for value in ports.values()):raise RuntimeError('invalid fixture port')
    config=command['config']
    if not isinstance(config,dict) or len(json.dumps(config))>50000:raise RuntimeError('invalid synthetic runtime config')
    upload(source,name+'.state.zip')
    config64=base64.b64encode(json.dumps(config,separators=(',',':')).encode()).decode()
    script=r'''$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$root='__ROOT__'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory(($root+'.state.zip'),(Join-Path $root 'native'))
    $project=Join-Path $root 'native\project';if(Test-Path -LiteralPath $project){Get-ChildItem -LiteralPath $project | Copy-Item -Destination (Join-Path $root 'destination') -Recurse -Force -ErrorAction Stop}
    $credential=Join-Path $root 'adapter.token';[IO.File]::WriteAllText($credential,'')
    $acl=Join-Path $root 'payload\src\windows-permissions.ps1';$powershell=Join-Path ([Environment]::GetEnvironmentVariable('SystemRoot')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $powershell -NoProfile -NonInteractive -File $acl -Path $credential -Created file
    if($LASTEXITCODE -ne 0){throw 'private adapter ACL failed'}
    [IO.File]::WriteAllText($credential,('8'*64))
    $node=Join-Path $root 'node\node-v24.21.0-win-x64\node.exe';if(-not (Test-Path -LiteralPath $node)){throw 'temporary node unavailable'}
    $win=[Environment]::GetEnvironmentVariable('SystemRoot');$native=Join-Path $root 'native'
    $i=New-Object Diagnostics.ProcessStartInfo;$i.FileName=Join-Path $root 'runtime\opencode.exe';$i.Arguments='serve --hostname 127.0.0.1 --port __API__';$i.WorkingDirectory=Join-Path $root 'destination';$i.UseShellExecute=$false;$i.CreateNoWindow=$true
    $i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true;$i.EnvironmentVariables.Clear()
    $vars=@{SystemRoot=$win;WINDIR=$win;PATH=((Split-Path $node)+';'+(Join-Path $win 'System32')+';'+$win);USERPROFILE=$root;APPDATA=(Join-Path $root 'roaming');LOCALAPPDATA=(Join-Path $root 'local');TEMP=$root;TMP=$root;XDG_CONFIG_HOME=(Join-Path $native 'config');XDG_DATA_HOME=(Join-Path $native 'data');XDG_CACHE_HOME=(Join-Path $native 'cache');XDG_STATE_HOME=(Join-Path $native 'state');OPENCODE_CONFIG_CONTENT=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CONFIG__'));OPENCODE_DISABLE_MODELS_FETCH='1';OPENCODE_DISABLE_FFF='1';OPENCODE_FILEWATCHER_DISABLE='1';TURNLINK_SYNTHETIC_GATEWAY_KEY=('5'*64);AGENT_CHANNEL_TOKEN=('7'*64);OPENCODE_SERVER_PASSWORD='turnlink-synthetic-only'}
    foreach($k in $vars.Keys){$i.EnvironmentVariables[$k]=[string]$vars[$k]}
    $p=New-Object Diagnostics.Process;$p.StartInfo=$i;if(-not $p.Start()){throw 'service did not start'}
    [IO.File]::WriteAllText((Join-Path $root 'server.pid'),[string]$p.Id)
    $o=$p.StandardOutput.ReadToEndAsync();$e=$p.StandardError.ReadToEndAsync()
    try{$p.WaitForExit()}finally{if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}}
    if($p.ExitCode -ne 0){$detail=$e.GetAwaiter().GetResult();if($detail.Length -gt 2000){$detail=$detail.Substring($detail.Length-2000)};[Console]::Error.WriteLine($detail);throw 'isolated service failed'} '''.replace('__ROOT__',remote).replace('__API__',str(ports['remoteApiPort'])).replace('__CONFIG__',config64)
    scriptfile=local/'run.ps1';scriptfile.write_text(script,encoding='utf-8');upload(scriptfile,name+'.ps1')
    forwards=['-o','ExitOnForwardFailure=yes','-L',f"127.0.0.1:{ports['apiPort']}:127.0.0.1:{ports['remoteApiPort']}",
      '-R',f"127.0.0.1:{ports['remoteBrokerPort']}:127.0.0.1:{ports['brokerPort']}",
      '-R',f"127.0.0.1:{ports['remoteModelPort']}:127.0.0.1:{ports['modelPort']}"]
    session_log=(local/'ssh-errors.log').open('wb')
    # Limit the execution-policy override to this synthetic fixture process;
    # do not change the machine's persistent policy.
    session=subprocess.Popen(ssh[:-1]+forwards+[ssh[-1],'powershell','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',remote+'.ps1'],
      stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=session_log)
    return {'started':True,'pid':session.pid}

def status():
    running=bool(session and session.poll() is None)
    if session_log:session_log.flush()
    error=''
    path=local/'ssh-errors.log'
    if path.exists():
        error=path.read_bytes()[-3000:].decode('utf-8',errors='replace')
        for secret in [('5'*64),('7'*64),('8'*64),'turnlink-synthetic-only']:
            error=error.replace(secret,'[redacted]')
    return {'running':running,'exitCode':session.returncode if session else None,'diagnostic':error}

def cleanup():
    global session,session_log,remote_touched
    if session and session.poll() is None:
        session.terminate()
        try:session.wait(timeout=5)
        except subprocess.TimeoutExpired:session.kill();session.wait()
    if session_log:session_log.close();session_log=None
    if not remote_touched:return
    script=r'''$ErrorActionPreference='Stop';$root='__ROOT__';$pidfile=Join-Path $root 'server.pid'
    if(Test-Path -LiteralPath $pidfile){$v=(Get-Content -LiteralPath $pidfile -Raw).Trim();if($v -match '^\d+$'){
      $p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v);$expected=Join-Path $root 'runtime\opencode.exe'
      if($p -and $p.ExecutablePath -ieq $expected){Stop-Process -Id ([int]$v) -Force -ErrorAction SilentlyContinue;Wait-Process -Id ([int]$v) -Timeout 10 -ErrorAction SilentlyContinue}}}
    for($attempt=0;$attempt -lt 20 -and [IO.Directory]::Exists($root);$attempt++){
      try{[IO.Directory]::Delete($root,$true)}catch{if($attempt -eq 19){throw};Start-Sleep -Milliseconds 500}}
    foreach($suffix in @('.zip','.ps1','.state.zip')){$p=$root+$suffix;if([IO.File]::Exists($p)){[IO.File]::Delete($p)}}
    if(Test-Path -LiteralPath $root){throw 'cleanup incomplete'};'CLEAN' '''.replace('__ROOT__',remote)
    if 'CLEAN' not in ps(script,timeout=120):raise RuntimeError('Windows fixture cleanup unconfirmed')
    remote_touched=False

try:
    for line in sys.stdin:
        try:
            command=json.loads(line)
            if command.get('op')=='prepare':result=prepare()
            elif command.get('op')=='start':result=start(command)
            elif command.get('op')=='status':result=status()
            elif command.get('op')=='cleanup':cleanup();result={'clean':True}
            else:raise RuntimeError('unsupported fixture command')
            print(json.dumps({'ok':True,'result':result}),flush=True)
        except Exception as error:print(json.dumps({'ok':False,'error':str(error)}),flush=True)
finally:
    try:cleanup()
    except Exception as error:print(json.dumps({'ok':False,'cleanup':str(error)}),flush=True)
    shutil.rmtree(local,ignore_errors=True)
