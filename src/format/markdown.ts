import { TRANSPORT_LABELS, type Report } from '../types.js';
import { HOMEPAGE } from '../version.js';
import {
  cellText,
  connectLines,
  detailText,
  probesFor,
  serverText,
  targetText,
  transportHeader,
} from './shared.js';

/** Escapes characters that would otherwise be read as Markdown or HTML. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|]/g, (char) => `\\${char}`).replace(/\r?\n/g, ' ');
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

export function formatMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('## mcp-compat report', '');
  lines.push(`Target: ${escapeMarkdown(targetText(report))}`, '');
  lines.push(`Server: ${escapeMarkdown(serverText(report))}`, '');

  lines.push(
    ...table(
      ['Version', ...transportHeader(report)],
      report.versions.map((version) => [
        version,
        ...probesFor(report, version).map((p) => escapeMarkdown(cellText(p))),
      ]),
    ),
  );

  lines.push('', '### Details', '');
  lines.push(
    ...table(
      ['Version', 'Transport', 'Result'],
      report.versions.flatMap((version) =>
        probesFor(report, version).map((probe) => [
          version,
          TRANSPORT_LABELS[probe.transport],
          escapeMarkdown(detailText(probe)),
        ]),
      ),
    ),
  );

  lines.push('', '### Who can connect', '');
  lines.push(...connectLines(report).map((line) => `- ${escapeMarkdown(line)}`));

  if (report.hints.length > 0) {
    lines.push('', '### Migration hints', '');
    lines.push(...report.hints.map((hint) => `- ${escapeMarkdown(hint.text)}`));
  }

  if (report.warnings.length > 0) {
    lines.push('', '### Warnings', '');
    lines.push(...report.warnings.map((warning) => `- ${escapeMarkdown(warning.text)}`));
  }

  lines.push('', `Checked with [mcp-compat](${HOMEPAGE}) ${report.tool.version}.`);
  return `${lines.join('\n')}\n`;
}
