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
 * Zero runtime dependencies: Node 18+ built-in fetch + readline.
 */
const readline = require('readline');

const DEFAULT_URL = 'http://127.0.0.1:8080';

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

  async post(path, body, headers = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetch(`${this.config.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
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

  async login() {
    if (!this.canLogin()) {
      throw new Error('set SYNAPCORES_API_KEY (or SYNAPCORES_USERNAME and SYNAPCORES_PASSWORD)');
    }
    const r = await this.post('/v1/auth/login', {
      username: this.config.username,
      password: this.config.password,
    });
    if (r.status !== 200 || !r.json || !r.json.access_token) {
      throw new Error(`login failed (HTTP ${r.status})`);
    }
    this.token = r.json.access_token;
  }

  /** Forward one JSON-RPC message (or batch). Returns the parsed reply, or null when there is none. */
  async send(message) {
    if (!this.token) await this.login();
    const path = Array.isArray(message) ? '/v1/mcp/batch' : '/v1/mcp';
    let r = await this.post(path, message, { Authorization: `Bearer ${this.token}` });
    if (r.status === 401 && this.canLogin()) {
      await this.login();
      r = await this.post(path, message, { Authorization: `Bearer ${this.token}` });
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

function errorReply(id, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message: `synapcores-mcp: ${message}` } };
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
  try {
    const reply = await gateway.send(msg).catch((e) => {
      const cause = e && e.cause && (e.cause.code || e.cause.message);
      throw new Error(cause ? `${e.message} (${cause}) at ${gateway.config.url}` : e.message);
    });
    // JSON-RPC: notifications never get a response.
    if (isNotification(msg) || reply == null) return null;
    if (Array.isArray(reply) && reply.length === 0) return null;
    return JSON.stringify(reply);
  } catch (e) {
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

module.exports = { Gateway, handleLine, readConfig, run, DEFAULT_URL };
