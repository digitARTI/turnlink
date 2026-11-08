// The app-server's initialize reply contains a userAgent with the caller's
// client name followed by the server version. Keep only a stable numeric
// version, and bind parsing to the exact name on the correlated request.
// This is observational metadata, not binary or native ownership attestation.
export function codexInitializeVersion(params, result) {
  const name = params?.clientInfo?.name, userAgent = result?.userAgent;
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 256 ||
      typeof userAgent !== 'string' || Buffer.byteLength(userAgent) > 2048) return undefined;
  const prefix = `${name}/`;
  if (!userAgent.startsWith(prefix)) return undefined;
  const version = /^(\d+\.\d+\.\d+)(?=\s|$)/.exec(userAgent.slice(prefix.length))?.[1];
  return version && version.length <= 32 ? version : undefined;
}
