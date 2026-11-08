#!/usr/bin/env node
'use strict';
/**
 * Live smoke test against a running SynapCores gateway.
 * Uses the same env vars as the server (SYNAPCORES_URL, SYNAPCORES_TOKEN or
 * SYNAPCORES_USERNAME/SYNAPCORES_PASSWORD). Prints tool names and a SELECT result.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'synapcores-mcp.js')], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
});
const msgs = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query', arguments: { sql: 'SELECT 1 + 1 AS two' } } },
  { jsonrpc: '2.0', id: 4, method: 'ping' },
];
let out = '';
child.stdout.on('data', (c) => (out += c));
for (const m of msgs) child.stdin.write(JSON.stringify(m) + '\n');
child.stdin.end();
child.on('close', (code) => {
  const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  const ok =
    code === 0 &&
    lines.length === 4 &&
    byId[1]?.result?.serverInfo &&
    Array.isArray(byId[2]?.result?.tools) &&
    byId[3]?.result &&
    !byId[3].result.isError &&
    byId[4]?.result;
  console.log('server:', JSON.stringify(byId[1]?.result?.serverInfo));
  console.log('tools :', (byId[2]?.result?.tools || []).map((t) => t.name).join(', '));
  console.log('query :', String(JSON.stringify(byId[3]?.result ?? byId[3]?.error)).slice(0, 300));
  console.log('lines :', lines.length, '(notification produced no output)');
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  process.exit(ok ? 0 : 1);
});
