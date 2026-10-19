# mcp-compat

**Check which MCP protocol versions and transports a server works with, and which clients can
connect to it.**

The 2026-07-28 revision of the [Model Context Protocol](https://modelcontextprotocol.io) is
stateless: there is no `initialize` handshake and no `Mcp-Session-Id`, and every request carries
its protocol version in `_meta`. Servers built for 2025-11-25 and earlier and clients built for
2026-07-28 do not work together unless one side falls back.

mcp-compat starts or connects to a server, tries every dated protocol version on every
transport, and reports what works, who can connect, and what to change. It runs as a CLI or as a
GitHub Action and only sends lifecycle, discovery and list requests.

## Usage

```bash
npx mcp-compat --stdio "node dist/index.js"
npx mcp-compat --stdio "npx -y @modelcontextprotocol/server-everything"
npx mcp-compat --url https://example.com/mcp --header "Authorization: Bearer $TOKEN"
npx mcp-compat --stdio "node dist/index.js" --fail-on no-modern,no-legacy
```

Requires Node.js 22 or later.

## Example output

`npx mcp-compat --stdio "node test/fixtures/servers/stdio-server.mjs legacy"` checks the legacy
test server in this repository, which supports 2025-11-25 and 2025-06-18. The output below
comes from `npm run demo`:

```text
mcp-compat 0.1.0
Target: node test/fixtures/servers/stdio-server.mjs legacy (stdio)
Server: legacy-fixture 1.4.0

Compatibility
  Version     stdio
  2026-07-28  fails
  2025-11-25  works
  2025-06-18  works
  2025-03-26  negotiated to 2025-11-25
  2024-11-05  negotiated to 2025-11-25

Details
  Version     Transport  Result
  2026-07-28  stdio      fails: server/discover returned error -32601: Method not found
  2025-11-25  stdio      works: tools 3, resources 1, prompts 2
  2025-06-18  stdio      works: tools 3, resources 1, prompts 2
  2025-03-26  stdio      negotiated to 2025-11-25: tools 3, resources 1, prompts 2
  2024-11-05  stdio      negotiated to 2025-11-25: tools 3, resources 1, prompts 2

Who can connect
  Legacy-era clients (initialize handshake): yes
  Modern-era clients (2026-07-28): no
  Dual-era clients: yes, by falling back to initialize

Migration hints
  - Add 2026-07-28 support: implement server/discover and read the protocol version and client
    capabilities from each request's _meta. Modern-era clients that do not fall back to initialize
    cannot connect.
```

## Options

| Option                | Description                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `--stdio <command>`   | Start the server with this command and talk to it over stdio. The command runs in the shell, so quote it. |
| `--url <url>`         | Talk to an HTTP server over Streamable HTTP and the deprecated HTTP+SSE transport.                        |
| `--header <header>`   | HTTP header to send with `--url`, as `"Name: value"`. Repeatable. Values are never printed.               |
| `--versions <list>`   | Comma-separated protocol versions to probe. Defaults to all of them.                                      |
| `--timeout <ms>`      | Time limit for each probe, from 100 to 600000. Defaults to 10000.                                         |
| `--format <format>`   | `text` (default), `markdown` or `json`.                                                                   |
| `--fail-on <checks>`  | Exit with code 1 if one of these checks matches (see below).                                              |
| `-o, --output <file>` | Write the report to a file instead of standard output.                                                    |
| `--no-color`          | Disable colors. Colors are also off when the output is not a terminal or `NO_COLOR` is set.               |
| `-h, --help`          | Show help.                                                                                                |
| `-v, --version`       | Show the version.                                                                                         |

Exit codes: `0` success, `1` a `--fail-on` check matched, `2` invalid arguments, `3` the server
could not be started or reached at all.

| Check                  | Matches when                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `no-modern`            | No 2026-07-28 probe worked, or 2026-07-28 was not in `--versions`. |
| `no-legacy`            | No legacy version worked, or none was in `--versions`.             |
| `deprecated-transport` | The server still serves the deprecated HTTP+SSE transport.         |
| `session-required`     | Streamable HTTP rejects requests that have no `Mcp-Session-Id`.    |
| `any-failure`          | At least one probe failed.                                         |

## GitHub Action

Build your server, then point the Action at it:

```yaml
name: MCP compatibility

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  mcp-compat:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci && npm run build
      - uses: MAcemek/mcp-compat@v0
        with:
          command: node dist/index.js
          fail-on: no-legacy
```

The Action writes the Markdown report to the job summary and the text report to the log. It
needs no token.

### Inputs

| Input      | Default | Description                                                                  |
| ---------- | ------- | ---------------------------------------------------------------------------- |
| `command`  | `''`    | Command that starts the server over stdio. Set this or `url`.                |
| `url`      | `''`    | URL of an HTTP server. Set this or `command`.                                |
| `headers`  | `''`    | HTTP headers for `url`, one `Name: value` per line. Values are masked.       |
| `versions` | `''`    | Comma-separated protocol versions to probe. Empty means all.                 |
| `timeout`  | `10000` | Time limit for each probe in milliseconds.                                   |
| `fail-on`  | `''`    | Comma-separated checks that fail the run, for example `no-modern,no-legacy`. |

### Outputs

| Output           | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `legacy`         | `true` if legacy-era clients can connect.                                              |
| `modern`         | `true` if modern-era (2026-07-28) clients can connect.                                 |
| `connect`        | `both`, `legacy-only`, `modern-only` or `neither`.                                     |
| `server-name`    | Name the server reports.                                                               |
| `server-version` | Version the server reports.                                                            |
| `matrix-json`    | JSON array of probes: `version`, `transport`, `status`, `negotiatedVersion`, `reason`. |
| `report-json`    | Path to the full JSON report (`$RUNNER_TEMP/mcp-compat-report.json`).                  |

## How it works

mcp-compat probes the dated versions from the
[specification repository](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/schema):
2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05. Every probe uses a fresh server
process or fresh HTTP requests, so nothing carries over from one probe to the next.

- **Legacy versions (2025-11-25 and earlier):** `initialize` asking for exactly that version,
  then `notifications/initialized` and `tools/list`, `resources/list` and `prompts/list` for the
  capabilities the server advertises. If the server answers with another version, the result is
  "negotiated to" that version.
- **2026-07-28:** `server/discover` and the list calls, each with `_meta` holding
  `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo` and empty
  `io.modelcontextprotocol/clientCapabilities`. On HTTP the requests also carry
  `MCP-Protocol-Version` and `Mcp-Method`. Missing `resultType`, `ttlMs`, `cacheScope` and
  `serverInfo` fields are reported as warnings.
- **Transports:** `--stdio` uses stdio. `--url` tries Streamable HTTP (POST) and the deprecated
  HTTP+SSE transport (GET on the same URL, waiting for the `endpoint` event).
- **Sessions:** when a legacy Streamable HTTP probe receives an `Mcp-Session-Id`, mcp-compat
  sends a `ping` without it to learn whether the server requires the session. A required
  session breaks behind load balancers without sticky sessions, and 2026-07-28 has no sessions.
  Each session is ended with `DELETE`.
- **Processes:** the stdio command runs in the shell (`/bin/sh` or `cmd.exe`). After each probe
  mcp-compat closes stdin, waits up to a second, then stops the whole process tree (the process
  group on Linux and macOS, `taskkill /T` on Windows).

"Legacy-era clients can connect" means at least one legacy version works or negotiates another
legacy version. "Modern-era clients can connect" means the 2026-07-28 probe works. Dual-era
clients can connect if either is true.

## Safety

mcp-compat never calls a tool, reads a resource or gets a prompt. The only messages it sends are
`initialize`, `notifications/initialized`, `ping`, `server/discover`, `tools/list`,
`resources/list` and `prompts/list`, plus `DELETE` for its own Streamable HTTP sessions. It
declares no client capabilities, answers `ping` from the server and rejects every other server
request, such as sampling, elicitation or roots, with a JSON-RPC error.

Header values are never printed, and URLs are printed without credentials or query values.
Starting a server with `--stdio` runs its code, so only check servers you would run anyway.

## Relation to the official conformance suite

mcp-compat is not a conformance test. The official
[MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
(`npx @modelcontextprotocol/conformance server --url ...`) runs strict pass/fail scenarios for
each specification version and is the place for deep conformance testing of SDKs and servers.
mcp-compat answers a narrower question quickly: which versions and transports a server works
with today, which clients can connect, and what to change, for both stdio and HTTP servers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
