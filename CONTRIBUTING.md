# Contributing

Thanks for helping improve the SynapCores MCP server.

## Reporting bugs and requesting features

Open an issue using one of the templates. For bugs, include the package version (`npx @synapcores/mcp --version`), your MCP client, your SynapCores engine version, and the JSON-RPC request and response if you have them. For security issues, see [SECURITY.md](SECURITY.md) instead.

## Development

```sh
git clone https://github.com/SynapCores/synapcores-mcp.git
cd synapcores-mcp
npm test                                   # unit tests, no engine needed
SYNAPCORES_API_KEY=... npm run smoke       # live check against a running engine
```

Ground rules:

- Zero runtime dependencies: Node.js 18+ built-ins only.
- stdout carries only JSON-RPC messages; diagnostics go to stderr.
- Keep `src/offline-tools.json` in sync with the engine's `/v1/mcp` `tools/list` (names and input schemas).
- Add or update a test in `test/` for every behaviour change.

## Pull requests

Keep each pull request focused on one change, describe what it does and how you tested it, and make sure `npm test` passes. Maintainers review pull requests and issues on a regular basis.
