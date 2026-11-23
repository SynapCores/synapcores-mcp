# Changelog

All notable changes to `@synapcores/mcp` are documented here.

## 1.0.1 (2026-11-23)

- Clearer tool definitions: every tool now has a title, MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), a description that says when to use it and which sibling tool fits better, and a description on every parameter, so agents pick the right tool the first time.
- More reliable discovery: when another HTTP service answers on the engine port, an HTTP 404/405 from `/v1/mcp` or `/v1/auth/login` is treated like no engine. `initialize`, `ping` and `tools/list` answer from the bundled catalog, and tool calls return a clear message asking you to start SynapCores.
- Step-by-step setup in the README: exact commands to start SynapCores and show the admin password and API key on macOS (including Homebrew and the first start), Linux and Windows (WSL2). The install one-liner carries `SYNAPCORES_REF=mcp-readme`.
- Community files: security policy, contributing guide, code of conduct, this changelog, and issue and pull request templates.

## 1.0.0 (2026-11-09)

- First release: stdio MCP server for the SynapCores AI-native database with 15 tools (SQL, vector search, Cypher graph, AutoML, LLM generation, agent memory inspection).
- API key (`SYNAPCORES_API_KEY`) or username/password authentication; read-only keys supported.
- `initialize`, `ping` and `tools/list` answer from a bundled catalog when the engine is unreachable, so MCP catalogs can inspect the server without an engine.
- Gateway authentication and HTTP errors become clean JSON-RPC errors.
- Zero runtime dependencies, Node.js 18+, MIT license.
