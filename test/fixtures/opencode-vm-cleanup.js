// Attempt every independent cleanup, but never remove a fixture root unless
// both VM owners have confirmed that their own service exited.
export async function cleanupVMResources({ actions, stopDest, stopPlugin, removeRoot }) {
  const failures = [];
  for (const action of actions) {
    try { await action(); } catch (error) { failures.push(error); }
  }
  let destStopped = false, pluginStopped = false;
  try { destStopped = await stopDest(); } catch (error) { failures.push(error); }
  try { pluginStopped = await stopPlugin(); } catch (error) { failures.push(error); }
  if (!destStopped || !pluginStopped) failures.push(new Error('VM stop was not confirmed'));
  if (destStopped && pluginStopped) {
    try { await removeRoot(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'VM fixture cleanup failed; unconfirmed resources retained');
  return { destStopped, pluginStopped };
}
