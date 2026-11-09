'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Gateway, handleLine, readConfig } = require('../src/bridge');

/** Minimal fake SynapCores gateway. */
function startFakeGateway({ expireFirstToken = false } = {}) {
  const state = { logins: 0, calls: [], issued: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      if (req.url === '/v1/auth/login') {
        if (json.username !== 'admin' || json.password !== 'pw') {
          res.writeHead(401).end('{"error":"bad"}');
          return;
        }
        state.logins += 1;
        const tok = `tok${state.logins}`;
        state.issued.push(tok);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: tok }));
        return;
      }
      const auth = req.headers.authorization || '';
      const tok = auth.replace('Bearer ', '');
      const valid = tok === 'static' || (state.issued.includes(tok) && !(expireFirstToken && tok === 'tok1'));
      if (!valid) {
        res.writeHead(401).end('{"error":"expired"}');
        return;
      }
      state.calls.push({ url: req.url, json });
      const reply = (m) => ({ jsonrpc: '2.0', id: m.id, result: { echo: m.method } });
      if (req.url === '/v1/mcp/batch') {
        const out = json.filter((m) => 'id' in m).map(reply);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
        return;
      }
      if (!('id' in json)) {
        res.writeHead(204).end();
        return;
      }
      if (json.method === 'boom') {
        res.writeHead(500).end('internal');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply(json)));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, url, state });
    });
  });
}

const cfg = (url, extra = {}) => ({ ...readConfig({}), url, ...extra });

test('readConfig defaults and trailing slash', () => {
  assert.strictEqual(readConfig({}).url, 'http://127.0.0.1:8080');
  assert.strictEqual(readConfig({ SYNAPCORES_URL: 'https://db.example.com///' }).url, 'https://db.example.com');
});

test('SYNAPCORES_API_KEY is the credential; SYNAPCORES_TOKEN is an alias', () => {
  assert.strictEqual(readConfig({ SYNAPCORES_API_KEY: 'k1' }).token, 'k1');
  assert.strictEqual(readConfig({ SYNAPCORES_TOKEN: 't1' }).token, 't1');
  assert.strictEqual(readConfig({ SYNAPCORES_API_KEY: 'k1', SYNAPCORES_TOKEN: 't1' }).token, 'k1');
});

test('token auth forwards a request', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'static' }));
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', gw);
  assert.deepStrictEqual(JSON.parse(out), { jsonrpc: '2.0', id: 1, result: { echo: 'tools/list' } });
  assert.strictEqual(g.state.logins, 0);
});

test('username/password logs in once and reuses the token', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { username: 'admin', password: 'pw' }));
  await handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', gw);
  await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', gw);
  assert.strictEqual(g.state.logins, 1);
});

test('re-logs in after a 401', async (t) => {
  const g = await startFakeGateway({ expireFirstToken: true });
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { username: 'admin', password: 'pw' }));
  const out = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":7,"method":"ping"}', gw));
  assert.strictEqual(out.id, 7);
  assert.strictEqual(g.state.logins, 2);
});

test('notifications produce no output (204 from gateway)', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'static' }));
  const out = await handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', gw);
  assert.strictEqual(out, null);
  assert.strictEqual(g.state.calls.length, 1);
});

test('batches go to /v1/mcp/batch', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'static' }));
  const out = JSON.parse(
    await handleLine('[{"jsonrpc":"2.0","id":1,"method":"a"},{"jsonrpc":"2.0","method":"n"},{"jsonrpc":"2.0","id":2,"method":"b"}]', gw),
  );
  assert.deepStrictEqual(out.map((r) => r.id), [1, 2]);
  assert.strictEqual(g.state.calls[0].url, '/v1/mcp/batch');
});

test('parse errors and gateway errors become JSON-RPC errors', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'static' }));
  assert.strictEqual(JSON.parse(await handleLine('{not json', gw)).error.code, -32700);
  const err = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":9,"method":"boom"}', gw));
  assert.strictEqual(err.id, 9);
  assert.match(err.error.message, /HTTP 500/);
});

test('missing credentials report a clear error and never crash', async () => {
  const gw = new Gateway(cfg('http://127.0.0.1:1'));
  const err = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', gw));
  assert.match(err.error.message, /SYNAPCORES_API_KEY/);
});

test('bad password does not leak the password', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { username: 'admin', password: 'super-secret-value' }));
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', gw);
  assert.match(out, /login failed \(HTTP 401\)/);
  assert.ok(!out.includes('super-secret-value'));
});

test('CLI end to end over stdio keeps order and skips notifications', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'synapcores-mcp.js')], {
    env: { PATH: process.env.PATH, SYNAPCORES_URL: g.url, SYNAPCORES_USERNAME: 'admin', SYNAPCORES_PASSWORD: 'pw' },
  });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  child.stdin.end();
  const code = await new Promise((r) => child.on('close', r));
  assert.strictEqual(code, 0);
  const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines.map((l) => l.id), [1, 2]);
});

test('--version prints the package version', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'synapcores-mcp.js'), '--version']);
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  await new Promise((r) => child.on('close', r));
  assert.strictEqual(out.trim(), require('../package.json').version);
});

test('an invalid token becomes a clean JSON-RPC error, never a raw gateway body', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'wrong' }));
  const out = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":7,"method":"tools/list"}', gw));
  assert.strictEqual(out.jsonrpc, '2.0');
  assert.strictEqual(out.id, 7);
  assert.match(out.error.message, /authentication failed/);
  assert.ok(!('result' in out));
});
