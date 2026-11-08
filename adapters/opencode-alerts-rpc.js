import { Rpc } from '@opencode/plugin/rpc';
import { AlertRequest, AlertSnapshot } from '../src/control/alert-contracts.js';

export const TurnlinkAlerts = Rpc.define({ id: 'turnlink.alerts', methods: {
  snapshot: { input: AlertRequest, output: AlertSnapshot },
}, events: {} });
