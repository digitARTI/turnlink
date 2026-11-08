// Experimental child-process preload. It narrows module resolution but is not
// by itself an operating-system sandbox or proof of all executed code.
import Module, { registerHooks, syncBuiltinESMExports } from 'node:module';

if (process.versions.node !== '24.21.0') throw new Error('SEALED_PLUGIN_RUNTIME_UNSUPPORTED');
const allowed = new Set(['node:module', 'node:child_process', 'node:crypto', 'node:events', 'node:fs', 'node:os', 'node:path',
  'node:timers/promises', 'node:url', 'assert', 'buffer', 'constants', 'crypto', 'events', 'fs', 'http', 'https', 'net', 'path', 'stream', 'tls', 'url', 'util', 'zlib']);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'file:///sealed/plugin.mjs' && !context.parentURL) return nextResolve(specifier, context);
  if (allowed.has(specifier)) return nextResolve(specifier, context);
  throw new Error('SEALED_PLUGIN_IMPORT_DENIED');
} });
// A later short-circuit hook would otherwise run before the seal. Lock both
// sync and async registration and update Node's named builtin exports.
for (const name of ['registerHooks', 'register']) Object.defineProperty(Module, name, {
  value: () => { throw new Error('SEALED_PLUGIN_HOOK_DENIED'); }, writable: false, configurable: false,
});
for (const name of ['_resolveFilename', '_load', '_findPath', '_resolveLookupPaths']) Object.defineProperty(Module, name, {
  value: Module[name], writable: false, configurable: false,
});
Object.defineProperty(Module.prototype, '_compile', { value: () => { throw new Error('SEALED_PLUGIN_COMPILE_DENIED'); }, writable: false, configurable: false });
Object.freeze(Module.prototype);
Object.freeze(Module._extensions);
Object.freeze(Module._cache);
syncBuiltinESMExports();
const getBuiltinModule = process.getBuiltinModule.bind(process);
Object.defineProperty(process, 'getBuiltinModule', { value: name => {
  if (typeof name !== 'string' || !allowed.has(name) || name === 'node:module' || name === 'node:child_process') throw new Error('SEALED_PLUGIN_BUILTIN_DENIED');
  return getBuiltinModule(name);
}, writable: false, configurable: false });
for (const name of ['binding', '_linkedBinding', '_debugProcess', '_debugEnd', '_kill', 'kill']) Object.defineProperty(process, name, {
  value: () => { throw new Error('SEALED_PLUGIN_PROCESS_CONTROL_DENIED'); }, writable: false, configurable: false,
});
Object.defineProperty(globalThis, 'WebAssembly', { value: undefined, writable: false, configurable: false });
