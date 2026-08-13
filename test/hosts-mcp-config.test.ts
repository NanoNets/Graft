import { test } from 'node:test';
import assert from 'node:assert/strict';

// The MCP launch command is resolved from PATH at init time; pin it to the npx
// form so these expectations are the same on every machine.
process.env.GRAFT_MCP_NPX = '1';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { registerMcpConfigs, resetGraftOnPathCache, serverEntry } from '../src/hosts/mcp-config.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-mcpcfg-')); }

test('cursor/gemini/kiro get repo-local JSON entries', () => {
  const repo = fresh(); const home = fresh();
  const w = registerMcpConfigs(repo, ['cursor', 'gemini', 'kiro'], { home });
  assert.deepEqual(w.map((x) => x.action), ['created', 'created', 'created']);
  const cursor = JSON.parse(readFileSync(join(repo, '.cursor', 'mcp.json'), 'utf8'));
  assert.deepEqual(cursor.mcpServers.graft, { command: 'npx', args: ['-y', '@nanonets/graft', 'mcp'] });
  assert.ok(existsSync(join(repo, '.gemini', 'settings.json')));
  assert.ok(existsSync(join(repo, '.kiro', 'settings', 'mcp.json')));
});

test('existing config keys are preserved; re-run is unchanged', () => {
  const repo = fresh(); const home = fresh();
  mkdirSync(join(repo, '.cursor'), { recursive: true });
  writeFileSync(join(repo, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  registerMcpConfigs(repo, ['cursor'], { home });
  const cfg = JSON.parse(readFileSync(join(repo, '.cursor', 'mcp.json'), 'utf8'));
  assert.ok(cfg.mcpServers.other, 'foreign server preserved');
  assert.ok(cfg.mcpServers.graft);
  const again = registerMcpConfigs(repo, ['cursor'], { home });
  assert.deepEqual(again.map((x) => x.action), ['unchanged']);
});

test('unparseable JSON is never clobbered', () => {
  const repo = fresh(); const home = fresh();
  mkdirSync(join(repo, '.cursor'), { recursive: true });
  writeFileSync(join(repo, '.cursor', 'mcp.json'), '{ not json');
  const w = registerMcpConfigs(repo, ['cursor'], { home });
  assert.deepEqual(w.map((x) => x.action), ['skipped-unparseable']);
  assert.equal(readFileSync(join(repo, '.cursor', 'mcp.json'), 'utf8'), '{ not json');
});

test('agents id: codex TOML + opencode JSON, gated on home dirs', () => {
  const repo = fresh(); const home = fresh();
  assert.deepEqual(registerMcpConfigs(repo, ['agents'], { home }), [], 'nothing without home dirs');
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  const w = registerMcpConfigs(repo, ['agents'], { home });
  assert.equal(w.length, 2);
  const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /^\[mcp_servers\.graft\]$/m);
  assert.match(toml, /"@nanonets\/graft"/);
  const oc = JSON.parse(readFileSync(join(repo, 'opencode.json'), 'utf8'));
  assert.equal(oc.mcp.graft.type, 'local');
  const again = registerMcpConfigs(repo, ['agents'], { home });
  assert.deepEqual(again.map((x) => x.action).sort(), ['unchanged', 'unchanged']);
});

test("global: 'if-present' never creates out-of-repo config, but still wires the repo", () => {
  // What an unsolicited refresh gets (see upkeep.ts#refreshOpts). ~/.codex/config.toml
  // is machine-wide; the repo's own opencode.json is part of the wiring being
  // refreshed, so the mode must not swallow that one too.
  const repo = fresh(); const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });

  const w = registerMcpConfigs(repo, ['agents'], { home, global: 'if-present' });
  const byId = new Map(w.map((x) => [x.id, x.action]));
  assert.equal(byId.get('codex'), 'skipped-absent', 'the machine-wide file is left alone');
  assert.equal(existsSync(join(home, '.codex', 'config.toml')), false);
  assert.equal(byId.get('opencode'), 'created', 'the repo-scoped file is still written');

  // Once graft IS registered there, the same mode reports it as ours and current.
  writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.graft]\ncommand = "graft"\n');
  const present = registerMcpConfigs(repo, ['agents'], { home, global: 'if-present' });
  assert.equal(new Map(present.map((x) => [x.id, x.action])).get('codex'), 'unchanged');
});

test('codex TOML append preserves existing content', () => {
  const repo = fresh(); const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n');
  registerMcpConfigs(repo, ['agents'], { home });
  const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /model = "o3"/);
  assert.match(toml, /\[mcp_servers\.other\]/);
  assert.match(toml, /\[mcp_servers\.graft\]/);
});

test('JSON with non-object mcpServers value is skipped', () => {
  const repo = fresh(); const home = fresh();
  mkdirSync(join(repo, '.cursor'), { recursive: true });
  const badJson = '{"mcpServers": "not-an-object"}';
  writeFileSync(join(repo, '.cursor', 'mcp.json'), badJson);
  const w = registerMcpConfigs(repo, ['cursor'], { home });
  assert.deepEqual(w.map((x) => x.action), ['skipped-unparseable']);
  assert.equal(readFileSync(join(repo, '.cursor', 'mcp.json'), 'utf8'), badJson);
});

// The launch command: bare binary when graft is installed, npx otherwise. Never an
// absolute path — these files are committed and shared between machines.
test('serverEntry prefers the installed binary and falls back to npx', () => {
  const saved = process.env.GRAFT_MCP_NPX;
  delete process.env.GRAFT_MCP_NPX;
  try {
    assert.deepEqual(serverEntry({ onPath: true }), { command: 'graft', args: ['mcp'] });
    assert.deepEqual(serverEntry({ onPath: false }), { command: 'npx', args: ['-y', '@nanonets/graft', 'mcp'] });
    for (const e of [serverEntry({ onPath: true }), serverEntry({ onPath: false })]) {
      assert.ok(!e.command.startsWith('/'), 'never an absolute path — configs get shared');
    }
  } finally {
    if (saved !== undefined) process.env.GRAFT_MCP_NPX = saved;
  }
});

test('GRAFT_MCP_NPX overrides an installed binary', () => {
  process.env.GRAFT_MCP_NPX = '1';
  assert.equal(serverEntry({ onPath: true }).command, 'npx', 'the escape hatch wins');
});

// --- the PATH detection itself ---
//
// The detection used to spawn `graft --version`, which on Windows meant ENOENT
// against the `graft.cmd` shim npm installs: BIN_LAUNCH was unreachable on the whole
// platform and every init committed the slow `npx` form into `.mcp.json`. It also
// paid a process spawn per call, five call sites deep in the init path.

/** Install a fake `graft` on PATH under whatever name this platform resolves. */
function stubGraftDir(): string {
  const dir = fresh();
  // Contents are irrelevant — the resolver asks whether the name resolves, not
  // whether the binary runs. `.cmd` is what `npm i -g` leaves on Windows.
  writeFileSync(join(dir, process.platform === 'win32' ? 'graft.cmd' : 'graft'), '');
  return dir;
}

function withEnv(path: string, fn: () => void): void {
  const savedPath = process.env.PATH;
  const savedNpx = process.env.GRAFT_MCP_NPX;
  delete process.env.GRAFT_MCP_NPX;
  process.env.PATH = path;
  resetGraftOnPathCache();
  try {
    fn();
  } finally {
    process.env.PATH = savedPath;
    if (savedNpx !== undefined) process.env.GRAFT_MCP_NPX = savedNpx;
    else delete process.env.GRAFT_MCP_NPX;
    resetGraftOnPathCache();
  }
}

test('serverEntry finds an installed graft on PATH (Windows: the .cmd shim)', () => {
  withEnv(stubGraftDir(), () => {
    assert.deepEqual(serverEntry(), { command: 'graft', args: ['mcp'] });
  });
});

test('serverEntry falls back to npx when nothing named graft is on PATH', () => {
  withEnv(fresh(), () => {
    assert.deepEqual(serverEntry(), { command: 'npx', args: ['-y', '@nanonets/graft', 'mcp'] });
  });
});

test('the PATH lookup happens once, not once per call site', () => {
  // `planInit` fans `serverEntry` out per host and per workspace child; the old
  // implementation paid a 5s-ceiling spawn for every one of them. Emptying PATH
  // mid-run and still getting the binary form is the observable proof it is cached.
  withEnv(stubGraftDir(), () => {
    assert.equal(serverEntry().command, 'graft');
    process.env.PATH = '';
    assert.equal(serverEntry().command, 'graft', 'resolved once and remembered');
  });
});
