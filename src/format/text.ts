import { TRANSPORT_LABELS, type ProbeStatus, type Report } from '../types.js';
import {
  cellText,
  connectLines,
  detailText,
  probesFor,
  serverText,
  targetText,
  transportHeader,
  wrap,
} from './shared.js';

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

/** Width that hint and warning text is wrapped at. */
const WRAP_WIDTH = 100;

const STATUS_COLORS: Record<ProbeStatus, string> = {
  works: GREEN,
  negotiated: YELLOW,
  fails: RED,
  'not-applicable': DIM,
};

/** Renders an aligned table. Each line starts with two spaces; trailing spaces are removed. */
export function renderTable(
  header: string[],
  rows: string[][],
  style?: (row: number, column: number, cell: string) => string,
): string[] {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const last = header.length - 1;
  const renderRow = (row: string[], index: number | null): string => {
    const cells = header.map((_, column) => {
      const cell = row[column] ?? '';
      const padded = column === last ? cell : cell.padEnd(widths[column] ?? 0);
      return index !== null && style ? style(index, column, padded) : padded;
    });
    return `  ${cells.join('  ')}`.trimEnd();
  };
  return [renderRow(header, null), ...rows.map((row, index) => renderRow(row, index))];
}

export function formatText(report: Report, options: { color: boolean }): string {
  const paint = (code: string, text: string): string =>
    options.color && text.trim() !== '' ? `${code}${text}${RESET}` : text;
  const bold = (text: string): string => paint(BOLD, text);
  const lines: string[] = [];

  lines.push(bold(`mcp-compat ${report.tool.version}`));
  lines.push(`Target: ${targetText(report)}`);
  lines.push(`Server: ${serverText(report)}`);

  const matrixRows = report.versions.map((version) => [
    version,
    ...probesFor(report, version).map(cellText),
  ]);
  const matrixStatus = report.versions.map((version) =>
    probesFor(report, version).map((p) => p.status),
  );
  lines.push('', bold('Compatibility'));
  lines.push(
    ...renderTable(['Version', ...transportHeader(report)], matrixRows, (row, column, cell) => {
      const status = matrixStatus[row]?.[column - 1];
      return status === undefined ? cell : paint(STATUS_COLORS[status], cell);
    }),
  );

  const details = report.versions.flatMap((version) =>
    probesFor(report, version).map((probe) => ({
      status: probe.status,
      row: [version, TRANSPORT_LABELS[probe.transport], detailText(probe)],
    })),
  );
  lines.push('', bold('Details'));
  lines.push(
    ...renderTable(
      ['Version', 'Transport', 'Result'],
      details.map((d) => d.row),
      (row, column, cell) => {
        const status = details[row]?.status;
        return column === 2 && status !== undefined ? paint(STATUS_COLORS[status], cell) : cell;
      },
    ),
  );

  lines.push('', bold('Who can connect'), ...connectLines(report).map((line) => `  ${line}`));

  if (report.hints.length > 0) {
    lines.push('', bold('Migration hints'));
    for (const hint of report.hints) lines.push(...wrap(hint.text, WRAP_WIDTH, '  - ', '    '));
  }

  if (report.warnings.length > 0) {
    lines.push('', bold('Warnings'));
    for (const warning of report.warnings) {
      lines.push(...wrap(warning.text, WRAP_WIDTH, '  - ', '    '));
    }
  }

  return `${lines.join('\n')}\n`;
}
