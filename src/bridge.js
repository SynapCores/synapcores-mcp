'use strict';
/**
 * SynapCores MCP server (stdio).
 *
 * stdio MCP clients (for example Claude Code) speak newline-delimited
 * JSON-RPC 2.0. The SynapCores gateway hosts its MCP server at
 * POST /v1/mcp. This module connects the two.
 *
 * stdout carries only JSON-RPC messages; diagnostics go to stderr.
 *
 * Offline fallback: when the engine cannot be reached (no credentials configured,
 * connection refused, DNS failure, timeout), `initialize`, `ping` and `tools/list`
 * are answered locally, `tools/list` from the bundled list of the 15 gateway tools
 * (src/offline-tools.json). Tool calls still need a running engine and return a
 * clear JSON-RPC error. When the engine is reachable, its live replies always win.
 *
 * Zero runtime dependencies: Node 18+ built-in fetch + readline.
 */
const readline = require('readline');
const pkg = require('../package.json');
const OFFLINE_TOOLS = require('./offline-tools.json').tools;

const DEFAULT_URL = 'http://127.0.0.1:8080';
// initialize / ping / tools/list should not hang for minutes when the engine host is unreachable.
const DISCOVERY_TIMEOUT_MS = 15000;
const DISCOVERY_METHODS = new Set(['initialize', 'ping', 'tools/list']);

/** The engine could not be reached at all (as opposed to answering with an error). */
class UnreachableError extends Error {
  constructor(message) {
    super(message);
    this.unreachable = true;
  }
}

function readConfig(env = process.env) {
  return {
    url: (env.SYNAPCORES_URL || DEFAULT_URL).replace(/\/+$/, ''),
    token: env.SYNAPCORES_API_KEY || env.SYNAPCORES_TOKEN || null,
    username: env.SYNAPCORES_USERNAME || null,
    password: env.SYNAPCORES_PASSWORD || null,
    timeoutMs: Number(env.SYNAPCORES_TIMEOUT_MS) || 300000,
  };
}

class Gateway {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.token = config.token;
    this.fetch = fetchImpl;
  }

  async post(path, body, headers = {}, timeoutMs = this.config.timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await this.fetch(`${this.config.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        // Network-level failure (refused, DNS, reset, timeout): there is no HTTP response at all.
        const cause = ctrl.signal.aborted
          ? `timed out after ${timeoutMs} ms`
          : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'network error';
        throw new UnreachableError(`SynapCores engine not reachable at ${this.config.url} (${cause})`);
      }
      const text = await res.text();
      let json = null;
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  canLogin() {
    return Boolean(this.config.username && this.config.password);
  }

  async login(timeoutMs) {
    if (!this.canLogin()) {
      throw new UnreachableError(
        'no credentials configured; set SYNAPCORES_API_KEY (or SYNAPCORES_USERNAME and SYNAPCORES_PASSWORD)'
      );
    }
    const r = await this.post(
      '/v1/auth/login',
      { username: this.config.username, password: this.config.password },
      {},
      timeoutMs
    );
    if (r.status !== 200 || !r.json || !r.json.access_token) {
      throw new Error(`login failed (HTTP ${r.status})`);
    }
    this.token = r.json.access_token;
  }

  /** Forward one JSON-RPC message (or batch). Returns the parsed reply, or null when there is none. */
  async send(message, { timeoutMs } = {}) {
    if (!this.token) await this.login(timeoutMs);
    const path = Array.isArray(message) ? '/v1/mcp/batch' : '/v1/mcp';
    let r = await this.post(path, message, { Authorization: `Bearer ${this.token}` }, timeoutMs);
    if (r.status === 401 && this.canLogin()) {
      await this.login(timeoutMs);
      r = await this.post(path, message, { Authorization: `Bearer ${this.token}` }, timeoutMs);
    }
    if (r.status === 502 || r.status === 503 || r.status === 504) {
      // A proxy or load balancer in front of the engine answered, but the engine itself is down.
      throw new UnreachableError(`SynapCores engine not reachable at ${this.config.url} (HTTP ${r.status})`);
    }
    if (r.status >= 400) {
      // Gateway-level errors (bad token, forbidden, …) are not JSON-RPC; turn them into a clean error.
      const j = r.json;
      const detail = j && (typeof j.error === 'string' ? j.error : (j.error && j.error.message) || j.message);
      throw new Error(
        r.status === 401
          ? `authentication failed (${detail || 'HTTP 401'}); check SYNAPCORES_API_KEY`
          : `gateway returned HTTP ${r.status}${detail ? `: ${detail}` : ''}`
      );
    }
    if (r.json) return r.json;
    if (r.status >= 200 && r.status < 300) return null; // e.g. 204 for notifications
    throw new Error(`gateway returned HTTP ${r.status}`);
  }
}

function isNotification(msg) {
  return msg && typeof msg === 'object' && !Array.isArray(msg) && !('id' in msg);
}

function isDiscovery(msg) {
  return Boolean(msg && typeof msg === 'object' && DISCOVERY_METHODS.has(msg.method));
}

function errorReply(id, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message: `synapcores-mcp: ${message}` } };
}

/** Local answer for one message while the engine is unreachable. Returns null for notifications. */
function offlineReply(msg, err) {
  if (isNotification(msg)) return null;
  const id = msg && typeof msg === 'object' ? msg.id : null;
  switch (msg && msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'synapcores-mcp', version: pkg.version },
          instructions:
            'The SynapCores engine is not reachable, so tools are listed from the bundled catalog. ' +
            'Tool calls need a running engine (set SYNAPCORES_URL and SYNAPCORES_API_KEY).',
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: OFFLINE_TOOLS } };
    default:
      return errorReply(
        id,
        `${err.message}. Tool calls need a running SynapCores engine: start it and set SYNAPCORES_URL and SYNAPCORES_API_KEY.`
      );
  }
}

/** Handle one stdin line. Returns the string to write to stdout, or null. */
async function handleLine(line, gateway) {
  if (!line.trim()) return null;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const msgs = Array.isArray(msg) ? msg : [msg];
  const discoveryOnly = msgs.length > 0 && msgs.every((m) => isDiscovery(m) || isNotification(m));
  const timeoutMs = discoveryOnly ? Math.min(DISCOVERY_TIMEOUT_MS, gateway.config.timeoutMs) : undefined;
  try {
    const reply = await gateway.send(msg, { timeoutMs });
    // JSON-RPC: notifications never get a response.
    if (isNotification(msg) || reply == null) return null;
    if (Array.isArray(reply) && reply.length === 0) return null;
    return JSON.stringify(reply);
  } catch (e) {
    if (e && e.unreachable) {
      if (!gateway.warnedOffline) {
        gateway.warnedOffline = true;
        process.stderr.write(`synapcores-mcp: ${e.message}; answering tools/list from the bundled catalog\n`);
      }
      const replies = msgs.map((m) => offlineReply(m, e)).filter(Boolean);
      if (!replies.length) return null;
      return JSON.stringify(Array.isArray(msg) ? replies : replies[0]);
    }
    if (isNotification(msg)) {
      process.stderr.write(`synapcores-mcp: ${e.message}\n`);
      return null;
    }
    if (Array.isArray(msg)) {
      const ids = msg.filter((m) => !isNotification(m)).map((m) => m.id);
      return ids.length ? JSON.stringify(ids.map((id) => errorReply(id, e.message))) : null;
    }
    return JSON.stringify(errorReply(msg.id, e.message));
  }
}

async function run({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const gateway = new Gateway(readConfig(env));
  const rl = readline.createInterface({ input, terminal: false });
  // Process sequentially so replies keep request order.
  for await (const line of rl) {
    const out = await handleLine(line, gateway);
    if (out) output.write(out + '\n');
  }
}

module.exports = { Gateway, handleLine, readConfig, run, DEFAULT_URL, OFFLINE_TOOLS };
