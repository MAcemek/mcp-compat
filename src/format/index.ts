import type { OutputFormat, Report } from '../types.js';
import { formatMarkdown } from './markdown.js';
import { formatText } from './text.js';

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatReport(
  report: Report,
  format: OutputFormat,
  options: { color: boolean },
): string {
  switch (format) {
    case 'text':
      return formatText(report, options);
    case 'markdown':
      return formatMarkdown(report);
    case 'json':
      return formatJson(report);
  }
}
