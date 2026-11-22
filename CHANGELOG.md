# Changelog

All notable changes to `@synapcores/mcp` are documented here.

## Unreleased

- README: the install one-liner carries `SYNAPCORES_REF=mcp-readme`, and a macOS note covers Homebrew (official install command) and the first start (admin password, http://localhost:8080).
- Tool definitions: every tool now has a title, MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), a description that says when to use it and which sibling tool to use instead, and a description on every parameter.
- Discovery keeps working when another HTTP service answers on the engine port: an HTTP 404/405 from `/v1/mcp` or `/v1/auth/login` is treated like no engine, so `initialize`, `ping` and `tools/list` answer from the bundled catalog, and tool calls report a clear error.

## 1.0.0 (2026-11-09)

- First release: stdio MCP server for the SynapCores AI-native database with 15 tools (SQL, vector search, Cypher graph, AutoML, LLM generation, agent memory inspection).
- API key (`SYNAPCORES_API_KEY`) or username/password authentication; read-only keys supported.
- `initialize`, `ping` and `tools/list` answer from a bundled catalog when the engine is unreachable, so MCP catalogs can inspect the server without an engine.
- Gateway authentication and HTTP errors become clean JSON-RPC errors.
- Zero runtime dependencies, Node.js 18+, MIT license.
