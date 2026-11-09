'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Gateway, handleLine, readConfig, OFFLINE_TOOLS } = require('../src/bridge');

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

test('missing credentials: discovery works offline, tool calls report a clear error', async () => {
  const gw = new Gateway(cfg('http://127.0.0.1:1'));
  const init = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', gw));
  assert.strictEqual(init.result.serverInfo.name, 'synapcores-mcp');
  const err = JSON.parse(
    await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1"}}}', gw),
  );
  assert.strictEqual(err.id, 2);
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

// ---- Offline fallback (no reachable engine) ----

const EXPECTED_TOOLS = [
  'describe_table', 'execute', 'list_tables', 'query', 'sql_manual', 'validate_query',
  'train_model', 'predict', 'list_models', 'describe_model',
  'semantic_search', 'embed_text', 'graph_query', 'generate_text', 'agent_soul',
];
const refusedFetch = async () => {
  const e = new TypeError('fetch failed');
  e.cause = { code: 'ECONNREFUSED' };
  throw e;
};

test('bundled catalog has the 15 gateway tools with input schemas', () => {
  assert.deepStrictEqual(OFFLINE_TOOLS.map((t) => t.name), EXPECTED_TOOLS);
  for (const t of OFFLINE_TOOLS) {
    assert.ok(t.description && t.description.length > 10, t.name);
    assert.strictEqual(t.inputSchema.type, 'object', t.name);
  }
});

test('engine unreachable: tools/list returns the bundled 15 tools', async () => {
  const gw = new Gateway(cfg('http://127.0.0.1:1', { token: 'static' }));
  const out = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":3,"method":"tools/list"}', gw));
  assert.strictEqual(out.id, 3);
  assert.deepStrictEqual(out.result.tools.map((t) => t.name), EXPECTED_TOOLS);
});

test('engine unreachable: initialize and ping answer locally, notifications stay silent', async () => {
  const gw = new Gateway(cfg('http://engine.invalid', { token: 'static' }), refusedFetch);
  const init = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}', gw));
  assert.ok(init.result.protocolVersion);
  assert.deepStrictEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.strictEqual(init.result.serverInfo.version, require('../package.json').version);
  assert.strictEqual(await handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', gw), null);
  assert.deepStrictEqual(JSON.parse(await handleLine('{"jsonrpc":"2.0","id":2,"method":"ping"}', gw)), {
    jsonrpc: '2.0', id: 2, result: {},
  });
});

test('engine unreachable: tools/call is a clear JSON-RPC error', async () => {
  const gw = new Gateway(cfg('http://engine.invalid', { token: 'static' }), refusedFetch);
  const out = JSON.parse(
    await handleLine('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1"}}}', gw),
  );
  assert.strictEqual(out.jsonrpc, '2.0');
  assert.strictEqual(out.id, 5);
  assert.strictEqual(out.error.code, -32000);
  assert.match(out.error.message, /not reachable at http:\/\/engine\.invalid \(ECONNREFUSED\)/);
  assert.match(out.error.message, /need a running SynapCores engine/);
  assert.ok(!('result' in out));
});

test('engine unreachable: batches get per-message offline replies', async () => {
  const gw = new Gateway(cfg('http://engine.invalid', { token: 'static' }), refusedFetch);
  const out = JSON.parse(
    await handleLine(
      '[{"jsonrpc":"2.0","id":1,"method":"tools/list"},{"jsonrpc":"2.0","method":"n"},{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query"}}]',
      gw,
    ),
  );
  assert.deepStrictEqual(out.map((r) => r.id), [1, 2]);
  assert.strictEqual(out[0].result.tools.length, 15);
  assert.strictEqual(out[1].error.code, -32000);
});

test('engine timeout falls back for tools/list', async () => {
  const hang = (url, opts) =>
    new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const gw = new Gateway(cfg('http://10.255.255.1', { token: 'static', timeoutMs: 50 }), hang);
  const out = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', gw));
  assert.strictEqual(out.result.tools.length, 15);
  const call = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query"}}', gw));
  assert.match(call.error.message, /timed out after 50 ms/);
});

test('live list wins whenever the engine is reachable (no sticky offline mode)', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  let down = true;
  const flaky = (url, opts) => (down ? refusedFetch() : globalThis.fetch(url, opts));
  const gw = new Gateway(cfg(g.url, { token: 'static' }), flaky);
  const offline = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', gw));
  assert.strictEqual(offline.result.tools.length, 15);
  down = false;
  const live = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', gw));
  assert.deepStrictEqual(live, { jsonrpc: '2.0', id: 2, result: { echo: 'tools/list' } });
});

test('auth failures are not treated as offline (engine reachable)', async (t) => {
  const g = await startFakeGateway();
  t.after(() => g.server.close());
  const gw = new Gateway(cfg(g.url, { token: 'wrong' }));
  const out = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', gw));
  assert.match(out.error.message, /authentication failed/);
});

test('CLI with no engine and no key: initialize + tools/list (15) + tools/call error', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'synapcores-mcp.js')], {
    env: { PATH: process.env.PATH, SYNAPCORES_URL: 'http://127.0.0.1:1' },
  });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1"}}}\n');
  child.stdin.end();
  const code = await new Promise((r) => child.on('close', r));
  assert.strictEqual(code, 0);
  const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines.map((l) => l.id), [1, 2, 3]);
  assert.strictEqual(lines[1].result.tools.length, 15);
  assert.strictEqual(lines[2].error.code, -32000);
});

test('a proxy 502/503/504 in front of a down engine falls back like a refused connection', async () => {
  const proxyDown = async () => new Response('Bad Gateway', { status: 502 });
  const gw = new Gateway(cfg('https://db.example.com', { token: 'static' }), proxyDown);
  const list = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', gw));
  assert.strictEqual(list.result.tools.length, 15);
  const call = JSON.parse(await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query"}}', gw));
  assert.match(call.error.message, /HTTP 502/);
});
