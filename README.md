# SynapCores MCP Server

[SynapCores](https://synapcores.com) is an AI-native database: SQL, vector search, a Cypher graph, in-database AutoML and LLM generation in one self-hosted engine. The engine has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server at `/v1/mcp`, so an AI assistant can query and build on your data directly.

This package, `@synapcores/mcp`, is the stdio connector for that server. It is small, MIT-licensed and has zero dependencies (Node.js 18+).

```
MCP client  ⇄  stdio  ⇄  @synapcores/mcp  ⇄  HTTP (JSON-RPC)  ⇄  SynapCores /v1/mcp
```

## Tools

The engine provides 15 tools:

| Tool | What it does |
|---|---|
| `list_tables` | List the tables in the database |
| `describe_table` | Columns, types and constraints for a table |
| `query` | Run a SELECT and return rows |
| `execute` | Run INSERT / UPDATE / DELETE and DDL (CREATE / ALTER / DROP) |
| `validate_query` | Check SQL syntax, optionally with the execution plan |
| `sql_manual` | SynapCores SQL syntax and examples |
| `semantic_search` | Similarity search over a vector collection; the query text is embedded for you |
| `embed_text` | Vector embedding for any text |
| `graph_query` | Cypher on the graph (MATCH / MERGE / CREATE / SET / DELETE, `gds` algorithms) |
| `train_model` | Train an AutoML model on a table column |
| `predict` | Score rows with a trained model |
| `list_models` | List trained models |
| `describe_model` | Algorithm, metrics and feature importance of a model |
| `generate_text` | Generate text with the engine's configured LLM |
| `agent_soul` | Inspect the database's learned runs, episodes, goals and plans (administrator key) |

The tools come from the engine, so they update when you upgrade SynapCores. If the engine isn't reachable, the server still starts and lists these 15 tools from a bundled copy (taken from SynapCores 2.4.8); tool calls then return an error asking you to start the engine.

## 1. Run SynapCores

```bash
curl -fsSL https://get.synapcores.com | sh
```

See [synapcores.com/download](https://synapcores.com/download) for other options. The gateway listens on `http://127.0.0.1:8080` by default.

## 2. Get an API key

Use an API key, not a login token: API keys don't expire after 24 hours. The installer prints one at first boot. To create a dedicated key:

```bash
TOKEN=$(curl -s http://127.0.0.1:8080/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<your admin password>"}' | jq -r .access_token)

curl -s http://127.0.0.1:8080/v1/api-keys -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"claude-code","permission":"FullAccess"}' | jq -r .raw_key
```

The key is shown once. Keep it in an environment variable:

```bash
export SYNAPCORES_API_KEY=<the key>
```

**Read-only keys:** create the key with `"permission":"ReadOnly"` to let the assistant read and search while the engine refuses SQL writes and DDL through `execute`, and Cypher writes through `graph_query`.

## 3. Add SynapCores to Claude Code

### stdio, with this package

```bash
claude mcp add synapcores \
  -e SYNAPCORES_URL=http://127.0.0.1:8080 \
  -e SYNAPCORES_API_KEY=$SYNAPCORES_API_KEY \
  -- npx -y @synapcores/mcp
```

### HTTP, no package

Claude Code can also talk to the engine's MCP endpoint directly:

```bash
claude mcp add --transport http synapcores http://127.0.0.1:8080/v1/mcp \
  --header "Authorization: Bearer $SYNAPCORES_API_KEY"
```

For a team repo, add `--scope project` and single-quote the header (`'Authorization: Bearer ${SYNAPCORES_API_KEY}'`) so `.mcp.json` stores the variable name, not the key.

Check the connection with `claude mcp list`, then ask:

> "What tables are in my SynapCores database? Describe the biggest one."

> "Find the five support articles most similar to 'reset my password'."

> "Train a model on `customers` to predict `churned`, then show the 10 highest-risk customers."

## Configuration

| Variable | Description |
|---|---|
| `SYNAPCORES_URL` | Gateway URL. Default `http://127.0.0.1:8080`. |
| `SYNAPCORES_API_KEY` | SynapCores API key, sent as `Authorization: Bearer`. |
| `SYNAPCORES_TIMEOUT_MS` | Per-request timeout. Default 300000 (5 minutes). |

Every tool call goes through the gateway's authentication, so the assistant sees exactly what its API key is allowed to see.

stdout carries only JSON-RPC messages; diagnostics go to stderr.

## Development

```bash
npm test                                   # unit tests (no engine needed)
SYNAPCORES_API_KEY=... npm run smoke       # live check against a running engine
```

## Links

- Website: https://synapcores.com
- Releases: https://github.com/SynapCores/synapcores-releases
- SQL reference: https://github.com/SynapCores/SQLv2

## License

MIT © SynapCores
