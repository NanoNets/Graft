/**
 * Register the graft MCP server in each host's config.
 * JSON hosts get a keyed merge (other servers preserved; unparseable files
 * are never rewritten). The TOML host gets an append-if-absent section.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface McpWrite {
  id: string;
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped-unparseable';
}

export const SERVER_ENTRY = { command: 'npx', args: ['-y', '@nanonets/graft', 'mcp'] };
const OPENCODE_ENTRY = { type: 'local', command: ['npx', '-y', '@nanonets/graft', 'mcp'], enabled: true };

function dirExists(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

export function mergeJsonKey(id: string, path: string, topKey: string, entry: object): McpWrite {
  let root: Record<string, any> = {};
  const existed = existsSync(path);
  if (existed) {
    try {
      root = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { id, path, action: 'skipped-unparseable' };
    }
  }
  const bucket = (root[topKey] ??= {});
  if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) {
    return { id, path, action: 'skipped-unparseable' };
  }
  if (JSON.stringify(bucket.graft) === JSON.stringify(entry)) return { id, path, action: 'unchanged' };
  const action = existed ? 'updated' : 'created';
  bucket.graft = entry;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`);
  return { id, path, action };
}

function upsertCodexToml(id: string, path: string): McpWrite {
  const existed = existsSync(path);
  const text = existed ? readFileSync(path, 'utf8') : '';
  if (/^\[mcp_servers\.graft\]$/m.test(text)) return { id, path, action: 'unchanged' };
  const section = `[mcp_servers.graft]\ncommand = "npx"\nargs = ["-y", "@nanonets/graft", "mcp"]\n`;
  const sep = text.length === 0 ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${text}${sep}${section}`);
  return { id, path, action: existed ? 'updated' : 'created' };
}

export function registerMcpConfigs(
  repo: string,
  ids: string[],
  opts: { home?: string } = {},
): McpWrite[] {
  const home = opts.home ?? homedir();
  const out: McpWrite[] = [];
  for (const id of ids) {
    switch (id) {
      case 'cursor':
        out.push(mergeJsonKey(id, join(repo, '.cursor', 'mcp.json'), 'mcpServers', SERVER_ENTRY));
        break;
      case 'gemini':
        out.push(mergeJsonKey(id, join(repo, '.gemini', 'settings.json'), 'mcpServers', SERVER_ENTRY));
        break;
      case 'kiro':
        out.push(mergeJsonKey(id, join(repo, '.kiro', 'settings', 'mcp.json'), 'mcpServers', SERVER_ENTRY));
        break;
      case 'agents':
        if (dirExists(join(home, '.codex'))) {
          out.push(upsertCodexToml('codex', join(home, '.codex', 'config.toml')));
        }
        if (dirExists(join(home, '.config', 'opencode'))) {
          out.push(mergeJsonKey('opencode', join(repo, 'opencode.json'), 'mcp', OPENCODE_ENTRY));
        }
        break;
      default:
        break; // copilot / windsurf / claude: no MCP target in this phase
    }
  }
  return out;
}
