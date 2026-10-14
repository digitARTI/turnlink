import { Plugin } from '@opencode/plugin';
import { setupOpenCode } from './opencode-runtime.js';

export default Plugin.define({ id: 'turnlink', setup: setupOpenCode });
