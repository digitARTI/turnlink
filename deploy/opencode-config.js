import { parse, modify, applyEdits } from 'jsonc-parser';

// Changes only the explicitly selected Turnlink entry. Unrelated config remains byte-preserved.
export function configureOpenCode(text, plugin, options) {
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || !Array.isArray(config.plugins)) throw new Error('Expected native OpenCode V2 plugins array; migrate configuration first');
  const matches = config.plugins.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry === plugin || entry?.package === plugin);
  if (matches.length !== 1) throw new Error('Expected exactly one selected Turnlink plugin entry; refuse unrelated or duplicate config');
  const { entry, index } = matches[0];
  const updated = { ...(typeof entry === 'object' ? entry : {}), package: plugin,
    options: { ...(entry.options || {}), ...options } };
  return applyEdits(text, modify(text, ['plugins', index], updated, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
