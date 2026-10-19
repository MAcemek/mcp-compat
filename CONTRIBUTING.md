# Contributing to mcp-compat

Thanks for contributing. Please be respectful in issues, reviews and code.

## Setup

You need Node.js 24 (see `.nvmrc`).

```bash
npm ci
npm run all
```

`npm run all` runs the format check, lint, type check, tests and build, which is the same as CI.

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm test`          | Runs the tests with Vitest against local fake servers. No network. |
| `npm run lint`      | Runs ESLint.                                                       |
| `npm run format`    | Formats everything with Prettier.                                  |
| `npm run typecheck` | Type-checks with `tsc` (no output files).                          |
| `npm run build`     | Bundles the Action into `dist/` and the CLI into `lib/`.           |
| `npm run demo`      | Runs the CLI against the legacy fake server in `test/fixtures`.    |

## Committing `dist/`

GitHub runs the bundled `dist/index.js`, so it is committed. After changing anything in `src/`,
run `npm run build` and commit `dist/` together with your change. CI fails if `dist/` is out
of date. `lib/` is the npm package bundle; it is built by `npm pack` and is not committed.

## How the code is organised

- `src/cli.ts` and `src/action.ts`: entry points.
- `src/cli-main.ts` and `src/action-main.ts`: testable runners that take their dependencies as
  arguments.
- `src/run.ts` and `src/probe.ts`: the probes for each version and transport.
- `src/transports/`: stdio (with process tree cleanup), Streamable HTTP and HTTP+SSE.
- `src/analyze.ts`: the summary, migration hints and `--fail-on` checks.
- `src/format/`: text, Markdown and JSON output.
- `test/fixtures/servers/`: fake MCP servers used by the tests, the demo and CI.

mcp-compat must never send a request with side effects. `src/protocol.ts` lists the methods it
may send, and `test/safety.test.ts` checks this.

## Changing the demo

The example output in `README.md` must match `npm run demo` exactly, and a test checks this. If
you change the output format or the legacy fake server, paste the new demo output into the
README.

## Pull requests

Fill in the PR template, link the issue you are fixing, and include tests.
