import { describe, expect, it } from 'vitest';
import {
  parseCliArgs,
  parseFailOn,
  parseHeader,
  parseTimeout,
  parseVersions,
} from '../src/args.js';
import { KNOWN_VERSIONS } from '../src/protocol.js';

describe('parseCliArgs', () => {
  it('applies defaults for a stdio target', () => {
    expect(parseCliArgs(['--stdio', 'node server.js --flag'])).toEqual({
      kind: 'run',
      options: {
        target: { kind: 'stdio', command: 'node server.js --flag' },
        versions: [...KNOWN_VERSIONS],
        timeoutMs: 10_000,
        format: 'text',
        failOn: [],
        output: null,
        noColor: false,
      },
    });
  });

  it('parses a URL target with headers and options', () => {
    const parsed = parseCliArgs([
      '--url',
      'https://example.com/mcp',
      '--header',
      'Authorization: Bearer abc',
      '--header',
      'X-Team:  blue ',
      '--versions',
      '2024-11-05,2026-07-28',
      '--timeout',
      '2500',
      '--format',
      'json',
      '--fail-on',
      'no-modern,any-failure',
      '-o',
      'out.json',
      '--no-color',
    ]);
    if (parsed.kind !== 'run') throw new Error('expected run');
    expect(parsed.options.target).toEqual({
      kind: 'url',
      url: new URL('https://example.com/mcp'),
      headers: [
        { name: 'Authorization', value: 'Bearer abc' },
        { name: 'X-Team', value: 'blue' },
      ],
    });
    expect(parsed.options.versions).toEqual(['2026-07-28', '2024-11-05']);
    expect(parsed.options.timeoutMs).toBe(2500);
    expect(parsed.options.format).toBe('json');
    expect(parsed.options.failOn).toEqual(['no-modern', 'any-failure']);
    expect(parsed.options.output).toBe('out.json');
    expect(parsed.options.noColor).toBe(true);
  });

  it('handles help and version', () => {
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('rejects invalid combinations', () => {
    expect(() => parseCliArgs([])).toThrow('Use --stdio "<command>" or --url <url>.');
    expect(() => parseCliArgs(['--stdio', 'x', '--url', 'http://a'])).toThrow(
      'Use either --stdio or --url, not both.',
    );
    expect(() => parseCliArgs(['--stdio', 'x', '--header', 'A: b'])).toThrow(
      '--header can only be used with --url.',
    );
    expect(() => parseCliArgs(['--url', 'ftp://a'])).toThrow(
      'Unsupported URL scheme "ftp:". Use http or https.',
    );
    expect(() => parseCliArgs(['--url', 'not a url'])).toThrow('Invalid URL "not a url".');
    expect(() => parseCliArgs(['--stdio', 'x', '--format', 'xml'])).toThrow(
      'Unknown format "xml". Use text, markdown or json.',
    );
    expect(() => parseCliArgs(['--stdio', 'x', 'extra'])).toThrow();
    expect(() => parseCliArgs(['--stdio', 'x', '--output', ''])).toThrow(
      '--output needs a file name.',
    );
  });
});

describe('parseHeader', () => {
  it('never echoes the value in errors', () => {
    expect(() => parseHeader('Bearer secret-value')).toThrow(
      'Invalid header. Use "Name: value", for example "Authorization: Bearer ...".',
    );
    expect(() => parseHeader('Bad Name: secret-value')).not.toThrow(/secret-value/);
    expect(() => parseHeader('X-Key:')).toThrow('Header X-Key needs a value on a single line.');
    expect(() => parseHeader('mcp-session-id: secret-value')).toThrow(
      'Header mcp-session-id is set by mcp-compat and cannot be overridden.',
    );
  });
});

describe('list parsers', () => {
  it('parses versions newest first and rejects unknown ones', () => {
    expect(parseVersions('')).toEqual([...KNOWN_VERSIONS]);
    expect(parseVersions('2025-03-26, 2025-11-25,2025-03-26')).toEqual([
      '2025-11-25',
      '2025-03-26',
    ]);
    expect(() => parseVersions('2025-01-01')).toThrow(
      'Unknown protocol version "2025-01-01". Use 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.',
    );
  });

  it('parses fail-on checks', () => {
    expect(parseFailOn(' No-Legacy ,deprecated-transport,no-legacy')).toEqual([
      'no-legacy',
      'deprecated-transport',
    ]);
    expect(() => parseFailOn('nope')).toThrow(
      'Unknown fail-on value "nope". Use no-modern, no-legacy, deprecated-transport, session-required, any-failure.',
    );
  });

  it('bounds the timeout', () => {
    expect(parseTimeout('100')).toBe(100);
    expect(parseTimeout('600000')).toBe(600_000);
    for (const value of ['99', '600001', '1.5', '-5', 'abc', '']) {
      expect(() => parseTimeout(value)).toThrow('Invalid timeout');
    }
  });
});
