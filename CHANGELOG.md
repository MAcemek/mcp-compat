# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-19

### Added

- First release of mcp-compat, a CLI (`npx mcp-compat`) and GitHub Action.
- Probes MCP protocol versions 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05
  over stdio (`--stdio`) or HTTP (`--url`), one fresh process or HTTP exchange per probe.
- Streamable HTTP and the deprecated HTTP+SSE transport, `--header` for credentials, and a check
  for servers that require `Mcp-Session-Id`.
- Compatibility matrix, list counts per version, a "who can connect" summary and migration
  hints, as text, Markdown or JSON.
- `--fail-on` with `no-modern`, `no-legacy`, `deprecated-transport`, `session-required` and
  `any-failure`, plus `--versions`, `--timeout` and `--output`.
- Only lifecycle, discovery and list requests are sent; server requests are rejected.
- Offline `npm run demo` against the fake servers in `test/fixtures/servers`.
