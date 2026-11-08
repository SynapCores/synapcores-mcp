# SynapCores MCP Server

Give Claude, Cursor, Windsurf, VS Code, Zed, or any [Model Context Protocol](https://modelcontextprotocol.io) client a full AI-native database. [SynapCores](https://synapcores.com) puts SQL, vector search, a Cypher graph, in-database AutoML, LLM generation and agent memory in one self-hosted engine. This server exposes all of it as MCP tools.

- **One server, every data model.** Query tables, run semantic search, traverse a graph, and train and score ML models from the same connection.
- **No SQL dialect to learn.** The tools wrap the engine's AI functions, so an assistant can run semantic search or train a model directly.
- **Your data stays with you.** SynapCores runs on your machine or your servers. The Community Edition is free.
- **Zero dependencies.** One small Node.js package (Node 18+).

Try SynapCores in the browser first: **[synapcores.com/playground](https://synapcores.com/playground)**

## Tools

| Tool | What it does |
|---|---|
| `list_tables` | List the tables in the database |
| `describe_table` | Columns, types and constraints for a table |
| `query` | Run a SELECT and return rows |
| `execute` | Run INSERT / UPDATE / DELETE and DDL |
| `validate_query` | Check SQL and show the plan without running it |
| `sql_manual` | Look up SynapCores SQL syntax and examples |
| `semantic_search` | Top-k similarity search over a vector collection; the query text is embedded for you |
| `embed_text` | Get an embedding vector for any text |
| `graph_query` | Run Cypher (MATCH / MERGE / CREATE / SET / DELETE) on the graph |
| `train_model` | Train an AutoML model on a table column |
| `predict` | Score rows with a trained model (calibrated probabilities for classification) |
| `list_models` | List trained models |
| `describe_model` | Algorithm, metrics and feature importance of a model |
| `generate_text` | Generate text with the engine's configured LLM |
| `agent_soul` | Inspect the database's learned agent memory: episodes, rewards, runs, plans and goals |

The tools come from the SynapCores engine itself, so they update when you upgrade the engine.

## 1. Run SynapCores

```bash
curl -fsSL https://get.synapcores.com | sh
```

Or use Docker (`synapcores/community` on Docker Hub). See [synapcores.com/download](https://synapcores.com/download). The gateway listens on `http://127.0.0.1:8080` by default.

## 2. Add the server to your client

### Claude Code

```bash
claude mcp add synapcores \
  --env SYNAPCORES_URL=http://127.0.0.1:8080 \
  --env SYNAPCORES_TOKEN=your-api-key \
  -- npx -y @synapcores/mcp
```

### Claude Desktop, Cursor, Windsurf, and other JSON-config clients

```json
{
  "mcpServers": {
    "synapcores": {
      "command": "npx",
      "args": ["-y", "@synapcores/mcp"],
      "env": {
        "SYNAPCORES_URL": "http://127.0.0.1:8080",
        "SYNAPCORES_TOKEN": "your-api-key"
      }
    }
  }
}
```

Config file locations:

- Claude Desktop: `claude_desktop_config.json`
- Cursor: `~/.cursor/mcp.json`
- Windsurf: `~/.codeium/windsurf/mcp_config.json`

### VS Code

```json
{
  "servers": {
    "synapcores": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@synapcores/mcp"],
      "env": { "SYNAPCORES_URL": "http://127.0.0.1:8080", "SYNAPCORES_TOKEN": "your-api-key" }
    }
  }
}
```

### LangChain, LangGraph, CrewAI

Any MCP adapter works. For example, with `langchain-mcp-adapters`:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "synapcores": {
        "command": "npx",
        "args": ["-y", "@synapcores/mcp"],
        "env": {"SYNAPCORES_URL": "http://127.0.0.1:8080", "SYNAPCORES_TOKEN": "your-api-key"},
        "transport": "stdio",
    }
})
tools = await client.get_tools()
```

## Configuration

| Variable | Description |
|---|---|
| `SYNAPCORES_URL` | Gateway URL. Default `http://127.0.0.1:8080`. |
| `SYNAPCORES_TOKEN` | API key or JWT (recommended). Create API keys in the SynapCores console or with `POST /v1/api-keys`. |
| `SYNAPCORES_USERNAME` / `SYNAPCORES_PASSWORD` | Log in with a username and password instead of a token. The server renews the session automatically. |
| `SYNAPCORES_TIMEOUT_MS` | Per-request timeout. Default 300000 (5 minutes). |

Every tool call goes through the gateway's authentication and tenant isolation. The assistant sees only what its API key is allowed to see. For read-only exploration, give it a read-only key.

## Try it

> "What tables are in my SynapCores database, and how many rows does each have?"

> "Train a model on `customers` to predict `churned`, then show the 10 highest-risk customers."

> "Find the five support articles most similar to 'reset my password'."

## How it works

```
MCP client  ⇄  stdio  ⇄  @synapcores/mcp  ⇄  HTTPS (JSON-RPC)  ⇄  SynapCores gateway /v1/mcp
```

The engine hosts the MCP server. This package connects stdio clients to it.

## Links

- Website: https://synapcores.com
- Playground: https://synapcores.com/playground
- Docs: https://docs.synapcores.com/mcp-setup/
- Releases: https://github.com/SynapCores/synapcores-releases

## License

MIT
