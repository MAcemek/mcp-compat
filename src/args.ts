import { parseArgs } from 'node:util';
import { errorMessage, UsageError } from './errors.js';
import { isKnownVersion, KNOWN_VERSIONS, type ProtocolVersion } from './protocol.js';
import { DEFAULT_TIMEOUT_MS } from './run.js';
import { RESERVED_HEADER_NAMES } from './transports/http-common.js';
import {
  FAIL_ON_IDS,
  type FailOnId,
  type HeaderPair,
  type OutputFormat,
  type Target,
} from './types.js';

export const HELP_TEXT = `Usage: mcp-compat --stdio "<command>" [options]
       mcp-compat --url <url> [options]

Checks which MCP protocol versions and transports a server works with, and
which clients can connect to it. Only lifecycle, discovery and list requests
are sent: no tool is called and no resource or prompt is read.

Target (one is required):
  --stdio <command>     Start the server with this command and talk to it
                        over stdio. The command runs in the shell; quote it
  --url <url>           Talk to an HTTP server over Streamable HTTP and the
                        deprecated HTTP+SSE transport
  --header <header>     Send an HTTP header, "Name: value". Repeatable, --url
                        only. Header values are never printed

Options:
  --versions <list>     Protocol versions to probe, comma-separated
                        (default: all of ${KNOWN_VERSIONS.slice(0, 2).join(', ')},
                        ${KNOWN_VERSIONS.slice(2).join(', ')})
  --timeout <ms>        Time limit for each probe (default: ${DEFAULT_TIMEOUT_MS})
  --format <format>     text, markdown or json (default: text)
  --fail-on <checks>    Exit with code 1 if one of these matches,
                        comma-separated: no-modern, no-legacy,
                        deprecated-transport, session-required, any-failure
  -o, --output <file>   Write the report to a file instead of stdout
  --no-color            Disable colors
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes: 0 success, 1 --fail-on matched, 2 usage error, 3 the server
could not be started or reached.
`;

export interface CliOptions {
  target: Target;
  versions: ProtocolVersion[];
  timeoutMs: number;
  format: OutputFormat;
  failOn: FailOnId[];
  output: string | null;
  noColor: boolean;
}

export type ParsedArgs =
  { kind: 'help' } | { kind: 'version' } | { kind: 'run'; options: CliOptions };

const FORMATS: readonly OutputFormat[] = ['text', 'markdown', 'json'];

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Parses a comma-separated list of fail-on checks. An empty string means none. */
export function parseFailOn(value: string): FailOnId[] {
  const result: FailOnId[] = [];
  for (const part of value.split(',')) {
    const id = part.trim().toLowerCase();
    if (id === '') continue;
    if (!(FAIL_ON_IDS as readonly string[]).includes(id)) {
      throw new UsageError(
        `Unknown fail-on value "${part.trim()}". Use ${FAIL_ON_IDS.join(', ')}.`,
      );
    }
    if (!result.includes(id as FailOnId)) result.push(id as FailOnId);
  }
  return result;
}

/** Parses a comma-separated version list, newest first. An empty string means all. */
export function parseVersions(value: string): ProtocolVersion[] {
  const requested: ProtocolVersion[] = [];
  for (const part of value.split(',')) {
    const version = part.trim();
    if (version === '') continue;
    if (!isKnownVersion(version)) {
      throw new UsageError(
        `Unknown protocol version "${version}". Use ${KNOWN_VERSIONS.join(', ')}.`,
      );
    }
    requested.push(version);
  }
  if (requested.length === 0) return [...KNOWN_VERSIONS];
  return KNOWN_VERSIONS.filter((v) => requested.includes(v));
}

export function parseTimeout(value: string): number {
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(ms) || ms < 100 || ms > 600_000) {
    throw new UsageError(
      `Invalid timeout "${value}". Use a number of milliseconds from 100 to 600000.`,
    );
  }
  return ms;
}

/** Parses "Name: value". The value is never included in error messages. */
export function parseHeader(value: string): HeaderPair {
  const colon = value.indexOf(':');
  const name = colon === -1 ? value.trim() : value.slice(0, colon).trim();
  if (colon === -1 || !HEADER_NAME.test(name)) {
    throw new UsageError(
      'Invalid header. Use "Name: value", for example "Authorization: Bearer ...".',
    );
  }
  const headerValue = value.slice(colon + 1).trim();
  if (headerValue === '' || /[\r\n\0]/.test(headerValue)) {
    throw new UsageError(`Header ${name} needs a value on a single line.`);
  }
  if (RESERVED_HEADER_NAMES.includes(name.toLowerCase())) {
    throw new UsageError(`Header ${name} is set by mcp-compat and cannot be overridden.`);
  }
  return { name, value: headerValue };
}

export function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UsageError(`Invalid URL "${value}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`Unsupported URL scheme "${url.protocol}". Use http or https.`);
  }
  return url;
}

/** Builds the target from the --stdio, --url and --header values (also used by the Action). */
export function parseTarget(
  command: string | undefined,
  url: string | undefined,
  headers: string[],
): Target {
  const stdio = command?.trim() ?? '';
  const http = url?.trim() ?? '';
  if (stdio !== '' && http !== '') throw new UsageError('Use either --stdio or --url, not both.');
  if (stdio === '' && http === '') throw new UsageError('Use --stdio "<command>" or --url <url>.');
  if (stdio !== '') {
    if (headers.length > 0) throw new UsageError('--header can only be used with --url.');
    return { kind: 'stdio', command: stdio };
  }
  return { kind: 'url', url: parseUrl(http), headers: headers.map(parseHeader) };
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        stdio: { type: 'string' },
        url: { type: 'string' },
        header: { type: 'string', multiple: true },
        versions: { type: 'string' },
        timeout: { type: 'string' },
        format: { type: 'string' },
        'fail-on': { type: 'string' },
        output: { type: 'string', short: 'o' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  const { values } = parsed;
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  const format = values.format ?? 'text';
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`Unknown format "${format}". Use text, markdown or json.`);
  }
  if (values.output === '') throw new UsageError('--output needs a file name.');
  return {
    kind: 'run',
    options: {
      target: parseTarget(values.stdio, values.url, values.header ?? []),
      versions: parseVersions(values.versions ?? ''),
      timeoutMs: values.timeout === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(values.timeout),
      format: format as OutputFormat,
      failOn: parseFailOn(values['fail-on'] ?? ''),
      output: values.output ?? null,
      noColor: values['no-color'] ?? false,
    },
  };
}
