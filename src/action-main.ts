import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { failOnMessage, matchFailOn } from './analyze.js';
import { parseFailOn, parseTarget, parseTimeout, parseVersions } from './args.js';
import { errorMessage } from './errors.js';
import { formatJson } from './format/index.js';
import { formatMarkdown } from './format/markdown.js';
import { formatText } from './format/text.js';
import type { ProtocolVersion } from './protocol.js';
import { DEFAULT_TIMEOUT_MS, runProbes } from './run.js';
import type { FetchFn } from './transports/http-common.js';
import type { FailOnId, Report, Target } from './types.js';

export const REPORT_FILE_NAME = 'mcp-compat-report.json';

export interface ActionInputs {
  target: Target;
  versions: ProtocolVersion[];
  timeoutMs: number;
  failOn: FailOnId[];
}

export interface ActionDeps {
  getInput: (name: string) => string;
  fetch: FetchFn;
  cwd: string;
  tempDir: string;
  info: (message: string) => void;
  setSecret: (value: string) => void;
  writeSummary: (markdown: string) => Promise<void>;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  platform?: NodeJS.Platform;
}

export function readActionInputs(getInput: (name: string) => string): ActionInputs {
  const headers = getInput('headers')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const timeout = getInput('timeout').trim();
  return {
    target: parseTarget(getInput('command'), getInput('url'), headers),
    versions: parseVersions(getInput('versions')),
    timeoutMs: timeout === '' ? DEFAULT_TIMEOUT_MS : parseTimeout(timeout),
    failOn: parseFailOn(getInput('fail-on')),
  };
}

/** The compact matrix published as the matrix-json output. */
export function matrixJson(report: Report): string {
  return JSON.stringify(
    report.probes.map((p) => ({
      version: p.version,
      transport: p.transport,
      status: p.status,
      negotiatedVersion: p.negotiatedVersion,
      reason: p.reason,
    })),
  );
}

/** Runs the GitHub Action. Reports problems through setFailed and never throws. */
export async function runAction(deps: ActionDeps): Promise<void> {
  try {
    const inputs = readActionInputs(deps.getInput);
    if (inputs.target.kind === 'url') {
      for (const header of inputs.target.headers) deps.setSecret(header.value);
    }
    const report = await runProbes(
      { target: inputs.target, versions: inputs.versions, timeoutMs: inputs.timeoutMs },
      { fetch: deps.fetch, cwd: deps.cwd, platform: deps.platform },
    );
    deps.info(formatText(report, { color: false }));
    await deps.writeSummary(formatMarkdown(report));

    const reportPath = join(deps.tempDir, REPORT_FILE_NAME);
    await writeFile(reportPath, formatJson(report), 'utf8');

    deps.setOutput('legacy', String(report.summary.legacy === true));
    deps.setOutput('modern', String(report.summary.modern === true));
    deps.setOutput('connect', report.summary.connect);
    deps.setOutput('server-name', report.server?.name ?? '');
    deps.setOutput('server-version', report.server?.version ?? '');
    deps.setOutput('matrix-json', matrixJson(report));
    deps.setOutput('report-json', reportPath);

    const matched = matchFailOn(report, inputs.failOn);
    if (matched.length > 0) deps.setFailed(failOnMessage(matched));
  } catch (error) {
    deps.setFailed(errorMessage(error));
  }
}
