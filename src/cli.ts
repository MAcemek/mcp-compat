#!/usr/bin/env node
import { runCli } from './cli-main.js';
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

process.exitCode = await runCli(process.argv.slice(2), {
  fetch: (input, init) => fetch(input, init),
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
});
