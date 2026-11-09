#!/usr/bin/env node
'use strict';
const { run } = require('../src/bridge');
const pkg = require('../package.json');

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  process.stdout.write(`synapcores-mcp ${pkg.version}
MCP server (stdio) for the SynapCores AI-native database.

Environment:
  SYNAPCORES_URL         Gateway URL (default http://127.0.0.1:8080)
  SYNAPCORES_API_KEY     SynapCores API key (sent as a Bearer token)
  SYNAPCORES_TIMEOUT_MS  Per-request timeout in ms (default 300000)

Source: https://github.com/SynapCores/synapcores-mcp
`);
  process.exit(0);
}

run().catch((e) => {
  process.stderr.write(`synapcores-mcp: ${e.message}\n`);
  process.exit(1);
});
