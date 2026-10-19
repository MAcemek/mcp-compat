import { LIST_KINDS } from '../protocol.js';
import { TRANSPORT_LABELS, type ProbeResult, type Report, type SessionMode } from '../types.js';

/** The matrix cell: works, negotiated to X, fails or n/a. */
export function cellText(probe: ProbeResult): string {
  switch (probe.status) {
    case 'works':
      return 'works';
    case 'negotiated':
      return `negotiated to ${probe.negotiatedVersion ?? '?'}`;
    case 'fails':
      return 'fails';
    case 'not-applicable':
      return 'n/a';
  }
}

/** "tools 3, resources 1, prompts 2; other capabilities: completions, logging". */
export function countsText(probe: ProbeResult): string {
  const parts = LIST_KINDS.filter((kind) => probe.counts[kind] !== null).map(
    (kind) => `${kind} ${probe.counts[kind]}`,
  );
  const lists = parts.length > 0 ? parts.join(', ') : 'no tools, resources or prompts';
  const others = probe.capabilities.filter((c) => !(LIST_KINDS as readonly string[]).includes(c));
  return others.length > 0 ? `${lists}; other capabilities: ${others.join(', ')}` : lists;
}

/** The result column of the details table. */
export function detailText(probe: ProbeResult): string {
  if (probe.status === 'fails' || probe.status === 'not-applicable') {
    return `${cellText(probe)}: ${probe.reason}`;
  }
  return `${cellText(probe)}: ${countsText(probe)}`;
}

/** The probes of one version, in transport order. */
export function probesFor(report: Report, version: string): ProbeResult[] {
  return report.transports.flatMap((transport) =>
    report.probes.filter((p) => p.version === version && p.transport === transport),
  );
}

export function transportHeader(report: Report): string[] {
  return report.transports.map((t) => TRANSPORT_LABELS[t]);
}

export function targetText(report: Report): string {
  const target = report.target;
  if (target.kind === 'stdio') return `${target.command} (stdio)`;
  const headers = target.headers.length > 0 ? `, headers: ${target.headers.join(', ')}` : '';
  return `${target.url} (HTTP${headers})`;
}

export function serverText(report: Report): string {
  if (!report.server) return 'unknown (no probe returned server information)';
  return report.server.version === ''
    ? report.server.name
    : `${report.server.name} ${report.server.version}`;
}

function yesNo(value: boolean | null): string {
  if (value === null) return 'not checked';
  return value ? 'yes' : 'no';
}

/** The "Who can connect" lines. */
export function connectLines(report: Report): string[] {
  const { summary } = report;
  const dual: Record<typeof summary.connect, string> = {
    both: 'yes',
    'legacy-only': 'yes, by falling back to initialize',
    'modern-only': 'yes, using 2026-07-28',
    neither: 'no',
  };
  const lines = [
    `Legacy-era clients (initialize handshake): ${yesNo(summary.legacy)}`,
    `Modern-era clients (2026-07-28): ${yesNo(summary.modern)}`,
    `Dual-era clients: ${dual[summary.connect]}`,
  ];
  if (summary.session !== null)
    lines.push(`Streamable HTTP sessions: ${sessionText(summary.session)}`);
  return lines;
}

function sessionText(session: SessionMode): string {
  switch (session) {
    case 'none':
      return 'not used';
    case 'optional':
      return 'issued, but requests without Mcp-Session-Id also work';
    case 'required':
      return 'required, requests without Mcp-Session-Id are rejected';
  }
}

/** Wraps text at `width` columns. The first line starts with `prefix`, the rest with `indent`. */
export function wrap(text: string, width: number, prefix: string, indent: string): string[] {
  const lines: string[] = [];
  let line = prefix;
  let empty = true;
  for (const word of text.split(' ').filter((w) => w !== '')) {
    if (!empty && line.length + 1 + word.length > width) {
      lines.push(line);
      line = `${indent}${word}`;
    } else {
      line = empty ? `${line}${word}` : `${line} ${word}`;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}
