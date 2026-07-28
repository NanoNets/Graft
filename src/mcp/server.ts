/**
 * Minimal MCP stdio server: newline-delimited JSON-RPC 2.0.
 * stdout carries protocol messages ONLY; diagnostics go to stderr.
 */
import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.js';

function send(msg: object): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id: unknown, result: object): void {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: unknown, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

export function startMcpServer(root: string, dirOverride?: string): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: { id?: unknown; method?: string; params?: Record<string, any> };
    try {
      msg = JSON.parse(text);
    } catch {
      replyError(null, -32700, 'parse error');
      return;
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined;
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'graft', version: '0' },
        });
        return;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notifications get no response
      case 'ping':
        if (!isNotification) reply(id, {});
        return;
      case 'tools/list':
        if (!isNotification) {
          reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
        }
        return;
      case 'tools/call': {
        if (isNotification) return;
        const name = String(params?.name ?? '');
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        // Async because a tool call may rebuild the graph first (see
        // graph/refresh.ts). `callTool` absorbs its own errors, so the only thing
        // that can reject here is a bug — surface it as a JSON-RPC error rather
        // than an unhandled rejection that kills the server.
        callTool(root, name, args, dirOverride).then(
          (r) => reply(id, { content: [{ type: 'text', text: r.text }], isError: r.isError }),
          (err) => replyError(id, -32603, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
      default:
        if (!isNotification) replyError(id, -32601, `method not found: ${method}`);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
