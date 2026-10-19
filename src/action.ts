import * as core from '@actions/core';
import { tmpdir } from 'node:os';
import { runAction } from './action-main.js';
import { killAllProcessTreesSync } from './transports/process-tree.js';

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    killAllProcessTreesSync();
    process.exit(code);
  });
}

await runAction({
  getInput: (name) => core.getInput(name),
  fetch: (input, init) => fetch(input, init),
  cwd: process.cwd(),
  tempDir: process.env.RUNNER_TEMP || tmpdir(),
  info: (message) => core.info(message),
  setSecret: (value) => core.setSecret(value),
  writeSummary: async (markdown) => {
    try {
      await core.summary.addRaw(markdown).write();
    } catch (error) {
      core.warning(`Could not write the job summary: ${String(error)}`);
    }
  },
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: (message) => core.setFailed(message),
});
