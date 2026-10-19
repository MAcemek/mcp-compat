import { runCli, type CliDeps } from '../../src/cli-main.js';

/** The command the demo and the README example run. */
export const DEMO_COMMAND = 'node test/fixtures/servers/stdio-server.mjs legacy';

/** Runs the real CLI against the legacy fixture server. Must run from the repo root. */
export async function runDemo(
  extraArgs: string[],
  io: Pick<CliDeps, 'stdout' | 'stderr' | 'env'>,
): Promise<number> {
  return runCli(['--stdio', DEMO_COMMAND, ...extraArgs], {
    fetch: (input, init) => fetch(input, init),
    cwd: process.cwd(),
    ...io,
  });
}
