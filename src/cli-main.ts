import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { failOnMessage, matchFailOn } from './analyze.js';
import { HELP_TEXT, parseCliArgs, type CliOptions } from './args.js';
import { errorMessage, UnreachableError, UsageError } from './errors.js';
import { formatReport } from './format/index.js';
import { runProbes } from './run.js';
import type { FetchFn } from './transports/http-common.js';
import { VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_FAIL_ON = 1;
export const EXIT_USAGE = 2;
export const EXIT_UNREACHABLE = 3;

export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface CliDeps {
  fetch: FetchFn;
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: OutputStream;
  stderr: OutputStream;
  platform?: NodeJS.Platform;
}

export function shouldUseColor(options: CliOptions, deps: CliDeps): boolean {
  if (options.format !== 'text' || options.noColor || options.output !== null) return false;
  if (deps.stdout.isTTY !== true) return false;
  const noColor = deps.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') return false;
  return deps.env.TERM !== 'dumb';
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let fromArgs = true;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === 'help') {
      deps.stdout.write(HELP_TEXT);
      return EXIT_OK;
    }
    if (parsed.kind === 'version') {
      deps.stdout.write(`${VERSION}\n`);
      return EXIT_OK;
    }
    fromArgs = false;
    const options = parsed.options;
    const report = await runProbes(
      { target: options.target, versions: options.versions, timeoutMs: options.timeoutMs },
      { fetch: deps.fetch, cwd: deps.cwd, platform: deps.platform },
    );
    const output = formatReport(report, options.format, { color: shouldUseColor(options, deps) });
    if (options.output !== null) {
      try {
        await writeFile(resolve(deps.cwd, options.output), output, 'utf8');
      } catch (error) {
        throw new UsageError(`Could not write ${options.output}: ${errorMessage(error)}`);
      }
      deps.stderr.write(`Report written to ${options.output}\n`);
    } else {
      deps.stdout.write(output);
    }
    const matched = matchFailOn(report, options.failOn);
    if (matched.length > 0) {
      deps.stderr.write(`mcp-compat: ${failOnMessage(matched)}\n`);
      return EXIT_FAIL_ON;
    }
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr.write(`mcp-compat: ${error.message}\n`);
      if (fromArgs) deps.stderr.write('Run "mcp-compat --help" for usage.\n');
      return EXIT_USAGE;
    }
    if (error instanceof UnreachableError) {
      deps.stderr.write(`mcp-compat: ${error.message}\n`);
      return EXIT_UNREACHABLE;
    }
    const detail = error instanceof Error && error.stack ? error.stack : String(error);
    deps.stderr.write(`mcp-compat: internal error: ${detail}\n`);
    return EXIT_USAGE;
  }
}
