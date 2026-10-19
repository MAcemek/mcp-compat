// A fake MCP server over stdio.
//
//   node test/fixtures/servers/stdio-server.mjs <profile> [--log <file>]
//   node test/fixtures/servers/stdio-server.mjs spawn-child <pid-file>
//
// Profiles from fixture-lib.mjs (legacy, modern, modern-minimal, dual, old, silent-legacy,
// crash-after-init, session, sse) plus the broken ones handled here: hang, crash, garbage,
// spawn-child and grandchild. --log appends the method of every received message to <file>.

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROFILES, handleRequest, rpcError, rpcResult } from './fixture-lib.mjs';

const args = process.argv.slice(2);
const profileName = args[0] ?? '';
const logIndex = args.indexOf('--log');
const logFile = logIndex === -1 ? null : args[logIndex + 1];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(text) {
  if (logFile) appendFileSync(logFile, `${text}\n`);
}

function keepAlive() {
  process.stdin.resume();
  setInterval(() => undefined, 60_000);
}

function onLines(handler) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== '') {
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          // Ignore lines that are not JSON.
        }
        if (message) {
          log(typeof message.method === 'string' ? message.method : 'response');
          handler(message);
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
}

function runHang() {
  onLines(() => undefined);
  keepAlive();
}

function runCrash() {
  process.stderr.write('fatal: missing API key\n', () => process.exit(1));
}

function runGarbage() {
  onLines((message) => {
    if (message.id === undefined) return;
    if (message.method === 'initialize') {
      process.stdout.write('this is not json\n');
      send({ jsonrpc: '2.0', id: message.id, result: 'oops' });
    } else if (message.method === 'server/discover') {
      send(rpcResult(message.id, { resultType: 'complete' }));
    } else {
      send(rpcError(message.id, -32601, 'Method not found'));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

function runSpawnChild(pidFile) {
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [self, 'grandchild'], { stdio: 'ignore' });
  writeFileSync(pidFile, String(child.pid));
  onLines(() => undefined);
  keepAlive();
}

function runProfile(profile) {
  if (profile.banner) process.stdout.write(`${profile.banner}\n`);
  let initialized = false;
  let pingAnswered = !profile.pingClient;
  const waiting = [];

  const answer = (message) => {
    const reply = handleRequest(profile, message);
    if (reply) send(reply);
  };

  onLines((message) => {
    if (message.method === undefined) {
      if (message.id === 'server-ping-1' && message.result !== undefined) {
        pingAnswered = true;
        for (const queued of waiting.splice(0)) answer(queued);
      }
      return;
    }
    if (message.id === undefined) {
      if (message.method === 'notifications/initialized' && profile.pingClient) {
        send({ jsonrpc: '2.0', id: 'server-ping-1', method: 'ping' });
        setTimeout(() => {
          for (const queued of waiting.splice(0)) {
            send(rpcError(queued.id, -32603, 'client did not answer ping'));
          }
        }, 2000).unref();
      }
      return;
    }
    if (profile.crashAfterInit && initialized) {
      process.stdin.pause();
      process.stderr.write(`crashed while handling ${message.method}\n`, () => process.exit(2));
      return;
    }
    if (message.method === 'initialize') initialized = true;
    if (!pingAnswered && message.method.endsWith('/list')) {
      waiting.push(message);
      return;
    }
    answer(message);
  });
  process.stdin.on('end', () => process.exit(0));
}

switch (profileName) {
  case 'hang':
    runHang();
    break;
  case 'crash':
    runCrash();
    break;
  case 'garbage':
    runGarbage();
    break;
  case 'spawn-child':
    runSpawnChild(args[1]);
    break;
  case 'grandchild':
    keepAlive();
    break;
  default: {
    const profile = PROFILES[profileName];
    if (!profile) {
      process.stderr.write(`unknown profile ${profileName}\n`);
      process.exit(64);
    }
    runProfile(profile);
  }
}
