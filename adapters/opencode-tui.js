import { Plugin } from '@opencode/plugin/tui';
import { setupOpenCodeAlertsUI } from './opencode-tui-runtime.js';

export default Plugin.define({ id: 'turnlink.cli', setup: setupOpenCodeAlertsUI });
