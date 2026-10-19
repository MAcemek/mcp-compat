// A fake MCP server over HTTP, bound to 127.0.0.1.
//
//   node test/fixtures/servers/http-server.mjs <profile> [port]
//
// prints "listening <url>" and runs until SIGINT or SIGTERM. Profiles:
//   dual            stateless Streamable HTTP, legacy and 2026-07-28
//   modern          2026-07-28 only; initialize gets an UnsupportedProtocolVersion error
//   legacy-session  legacy only, requires Mcp-Session-Id, answers over SSE
//   sse-only        the deprecated HTTP+SSE transport only (GET opens the event stream)
//
// Tests import startFixtureServer() instead and read the request log.

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  META_PROTOCOL_VERSION,
  MODERN,
  PROFILES,
  handleLegacy,
  handleModern,
  isModernRequest,
  isObject,
  modernStatus,
  rpcError,
} from './fixture-lib.mjs';

const HTTP_PROFILES = {
  dual: { profile: 'dual', mode: 'stateless' },
  modern: { profile: 'modern', mode: 'modern-only' },
  'legacy-session': { profile: 'session', mode: 'session' },
  'sse-only': { profile: 'sse', mode: 'sse' },
};

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, message, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(message));
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function sseEvent(message) {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

/**
 * Starts a fixture server. options.port defaults to 0 (any free port); options.token makes
 * every request need "Authorization: Bearer <token>"; options.echoSession makes 2026-07-28
 * responses carry an Mcp-Session-Id header they should not have.
 */
export async function startFixtureServer(name, options = {}) {
  const config = HTTP_PROFILES[name];
  if (!config) throw new Error(`unknown HTTP profile ${name}`);
  const profile = PROFILES[config.profile];
  const requests = [];
  const sessions = new Set();
  const streams = new Map();
  let counter = 0;

  const record = (req, message) => {
    requests.push({
      httpMethod: req.method ?? '',
      path: req.url ?? '',
      rpcMethod: isObject(message) && typeof message.method === 'string' ? message.method : null,
      id: isObject(message) && message.id !== undefined ? message.id : null,
      error: isObject(message) && isObject(message.error) ? message.error.code : null,
      session: req.headers['mcp-session-id'] ?? null,
      protocolVersion: req.headers['mcp-protocol-version'] ?? null,
      mcpMethod: req.headers['mcp-method'] ?? null,
      authorized: req.headers.authorization !== undefined,
    });
  };

  const handleStateless = (req, res, message) => {
    if (isModernRequest(message)) {
      const declared = message.params._meta[META_PROTOCOL_VERSION];
      if (
        req.headers['mcp-protocol-version'] !== declared ||
        req.headers['mcp-method'] !== message.method
      ) {
        sendJson(res, 400, rpcError(message.id, -32020, 'Header mismatch'));
        return;
      }
      const reply = handleModern(profile, message);
      const extra = options.echoSession ? { 'Mcp-Session-Id': 'not-expected' } : {};
      sendJson(res, modernStatus(reply), reply, extra);
      return;
    }
    if (config.mode === 'modern-only') {
      const requested =
        isObject(message.params) && typeof message.params.protocolVersion === 'string'
          ? message.params.protocolVersion
          : 'none';
      sendJson(
        res,
        400,
        rpcError(
          message.id,
          -32022,
          `Unsupported protocol version: ${requested}. This server supports ${MODERN}.`,
          { supported: [MODERN], requested },
        ),
      );
      return;
    }
    sendJson(res, 200, handleLegacy(profile, message));
  };

  const handleSession = (req, res, message) => {
    const sessionId = req.headers['mcp-session-id'];
    if (message.method === 'initialize' && sessionId === undefined) {
      const id = `session-${++counter}`;
      sessions.add(id);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': id });
      res.end(sseEvent(handleLegacy(profile, message)));
      return;
    }
    if (sessionId === undefined) {
      sendJson(res, 400, rpcError(null, -32000, 'Bad Request: Mcp-Session-Id header is required'));
      return;
    }
    if (!sessions.has(sessionId)) {
      sendJson(res, 404, rpcError(null, -32001, 'Session not found'));
      return;
    }
    if (message.id === undefined || message.method === undefined) {
      sendEmpty(res, 202);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (message.method === 'tools/list') {
      // A server request that a well-behaved client must answer with an error.
      res.write(
        sseEvent({
          jsonrpc: '2.0',
          id: 'server-sampling-1',
          method: 'sampling/createMessage',
          params: { messages: [], maxTokens: 1 },
        }),
      );
    }
    res.end(sseEvent(handleLegacy(profile, message)));
  };

  const openStream = (req, res) => {
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/event-stream')) {
      sendEmpty(res, 406);
      return;
    }
    const id = `sse-${++counter}`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': connected\n\n');
    res.write(`event: endpoint\ndata: /messages?sessionId=${id}\n\n`);
    streams.set(id, res);
    req.on('close', () => streams.delete(id));
  };

  const handleSseMessage = (req, res, message, sessionId) => {
    const stream = streams.get(sessionId);
    if (!stream) {
      sendEmpty(res, 404);
      return;
    }
    res.writeHead(202);
    res.end('Accepted');
    if (message.id !== undefined && message.method !== undefined) {
      const reply = handleLegacy(profile, message);
      if (reply) stream.write(sseEvent(reply));
    }
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        record(req, null);
        sendEmpty(res, 401, { 'WWW-Authenticate': 'Bearer' });
        return;
      }
      if (config.mode === 'sse' && req.method === 'GET' && url.pathname === '/mcp') {
        record(req, null);
        openStream(req, res);
        return;
      }
      if (config.mode === 'sse' && req.method === 'POST' && url.pathname === '/messages') {
        const message = JSON.parse(await readBody(req));
        record(req, message);
        handleSseMessage(req, res, message, url.searchParams.get('sessionId'));
        return;
      }
      if (url.pathname !== '/mcp') {
        record(req, null);
        sendEmpty(res, 404);
        return;
      }
      if (req.method === 'DELETE' && config.mode === 'session') {
        record(req, null);
        const deleted = sessions.delete(req.headers['mcp-session-id'] ?? '');
        sendEmpty(res, deleted ? 200 : 404);
        return;
      }
      if (req.method !== 'POST' || config.mode === 'sse') {
        record(req, null);
        sendEmpty(res, 405, { Allow: 'POST' });
        return;
      }
      let message;
      try {
        message = JSON.parse(await readBody(req));
      } catch {
        record(req, null);
        sendJson(res, 400, rpcError(null, -32700, 'Parse error'));
        return;
      }
      record(req, message);
      if (config.mode === 'session') {
        handleSession(req, res, message);
      } else if (message.id === undefined || message.method === undefined) {
        sendEmpty(res, 202);
      } else {
        handleStateless(req, res, message);
      }
    })().catch(() => {
      if (!res.headersSent) sendEmpty(res, 500);
      else res.end();
    });
  });

  await new Promise((resolveListen) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close: () =>
      new Promise((resolveClose) => {
        for (const stream of streams.values()) stream.end();
        streams.clear();
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === self.toLowerCase()
    : resolve(entry) === self;
}

if (isMain()) {
  const name = process.argv[2] ?? '';
  const port = Number(process.argv[3] ?? '0');
  const fixture = await startFixtureServer(name, { port });
  process.stdout.write(`listening ${fixture.url}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void fixture.close().then(() => process.exit(0));
    });
  }
}
