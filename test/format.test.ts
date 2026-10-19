import { describe, expect, it } from 'vitest';
import { collectWarnings, deriveHints, summarize } from '../src/analyze.js';
import { formatJson, formatReport } from '../src/format/index.js';
import { escapeMarkdown, formatMarkdown } from '../src/format/markdown.js';
import { wrap } from '../src/format/shared.js';
import { formatText } from '../src/format/text.js';
import { emptyProbe, notApplicableProbe } from '../src/probe.js';
import type { ProtocolVersion } from '../src/protocol.js';
import type { ProbeResult, Report, TransportId } from '../src/types.js';

function make(
  version: ProtocolVersion,
  transport: TransportId,
  patch: Partial<ProbeResult>,
): ProbeResult {
  return { ...emptyProbe(version, transport), reached: true, ...patch };
}

function urlReport(): Report {
  const versions: ProtocolVersion[] = ['2026-07-28', '2025-11-25'];
  const probes = [
    make('2026-07-28', 'streamable-http', {
      status: 'fails',
      failure: 'http',
      httpStatus: 400,
      reason: 'server/discover returned HTTP 400 with error -32000: a | b',
    }),
    notApplicableProbe('2026-07-28', 'http-sse'),
    make('2025-11-25', 'streamable-http', {
      status: 'works',
      negotiatedVersion: '2025-11-25',
      serverInfo: { name: 'demo_server', version: '1.0.0' },
      capabilities: ['logging', 'tools'],
      counts: { tools: 5, resources: null, prompts: null },
      session: 'optional',
      warnings: [{ id: 'invalid-message', text: 'server sent an invalid JSON-RPC message (x)' }],
    }),
    make('2025-11-25', 'http-sse', {
      status: 'negotiated',
      negotiatedVersion: '2024-11-05',
      capabilities: [],
      counts: { tools: null, resources: null, prompts: null },
    }),
  ];
  const summary = summarize(probes, versions);
  const warnings = collectWarnings(probes);
  return {
    tool: { name: 'mcp-compat', version: '0.1.0' },
    target: { kind: 'url', url: 'https://example.com/mcp', headers: ['Authorization'] },
    versions,
    transports: ['streamable-http', 'http-sse'],
    server: { name: 'demo_server', version: '1.0.0' },
    probes,
    summary,
    hints: deriveHints(probes, versions, summary, warnings),
    warnings,
  };
}

describe('formatMarkdown', () => {
  it('renders the matrix, details, summary and hints', () => {
    expect(formatMarkdown(urlReport())).toBe(`## mcp-compat report

Target: https://example.com/mcp (HTTP, headers: Authorization)

Server: demo\\_server 1.0.0

| Version | Streamable HTTP | HTTP+SSE |
| --- | --- | --- |
| 2026-07-28 | fails | n/a |
| 2025-11-25 | works | negotiated to 2024-11-05 |

### Details

| Version | Transport | Result |
| --- | --- | --- |
| 2026-07-28 | Streamable HTTP | fails: server/discover returned HTTP 400 with error -32000: a \\| b |
| 2026-07-28 | HTTP+SSE | n/a: 2026-07-28 does not define HTTP+SSE |
| 2025-11-25 | Streamable HTTP | works: tools 5; other capabilities: logging |
| 2025-11-25 | HTTP+SSE | negotiated to 2024-11-05: no tools, resources or prompts |

### Who can connect

- Legacy-era clients (initialize handshake): yes
- Modern-era clients (2026-07-28): no
- Dual-era clients: yes, by falling back to initialize
- Streamable HTTP sessions: issued, but requests without Mcp-Session-Id also work

### Migration hints

- Add 2026-07-28 support: implement server/discover and read the protocol version and client capabilities from each request's \\_meta. Modern-era clients that do not fall back to initialize cannot connect.
- HTTP+SSE is deprecated. Keep it only as long as older clients need it, next to Streamable HTTP.

### Warnings

- server sent an invalid JSON-RPC message (x)

Checked with [mcp-compat](https://github.com/MAcemek/mcp-compat) 0.1.0.
`);
  });

  it('escapes Markdown characters', () => {
    expect(escapeMarkdown('a|b *c* <d>\nnext')).toBe('a\\|b \\*c\\* \\<d\\> next');
  });
});

describe('formatText', () => {
  it('colors the cells only when asked', () => {
    const plain = formatText(urlReport(), { color: false });
    expect(plain).not.toContain('\u001b[');
    expect(plain).toContain('  2025-11-25  works            negotiated to 2024-11-05\n');
    const colored = formatText(urlReport(), { color: true });
    expect(colored).toContain('\u001b[32mworks');
    expect(colored).toContain('\u001b[31mfails');
    expect(colored).toContain('\u001b[1mCompatibility\u001b[0m');
  });

  it('wraps long lines', () => {
    expect(wrap('one two three four', 12, '  - ', '    ')).toEqual([
      '  - one two',
      '    three',
      '    four',
    ]);
  });
});

describe('formatReport', () => {
  it('selects the format', () => {
    const report = urlReport();
    expect(formatReport(report, 'json', { color: false })).toBe(formatJson(report));
    expect(JSON.parse(formatJson(report))).toEqual(report);
    expect(formatReport(report, 'markdown', { color: false })).toBe(formatMarkdown(report));
  });
});
