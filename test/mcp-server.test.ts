import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function rpc(messages: object[], dir: string, expected: number): Promise<any[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'mcp', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  const responses: any[] = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });
  for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
  const deadline = Date.now() + 15000;
  while (responses.length < expected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  await once(child, 'exit').catch(() => {});
  return responses;
}

test('initialize → tools/list → tools/call round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'graft-mcpsrv-'));
  const rs = await rpc(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graft_trace_calls', arguments: { symbol: 'x.ts', depth: 2 } } },
    ],
    dir,
    3,
  );
  assert.equal(rs.length, 3);
  const init = rs.find((r) => r.id === 1);
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.ok(init.result.capabilities.tools);
  assert.equal(init.result.serverInfo.name, 'graft');
  const list = rs.find((r) => r.id === 2);
  assert.deepEqual(list.result.tools.map((t: any) => t.name), [
    'graft_find_code',
    'graft_file_api',
    'graft_check_freshness',
    'graft_trace_calls',
    'graft_find_all',
    'graft_repo_map',
  ]);
  const call = rs.find((r) => r.id === 3);
  assert.equal(call.result.isError, true); // unbuilt repo → soft error content
  assert.match(call.result.content[0].text, /graft build/);
});

test('initialize carries instructions — the layer that survives tool deferral', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'graft-mcpsrv-instr-'));
  const rs = await rpc(
    [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }],
    dir,
    1,
  );
  const { instructions, serverInfo } = rs[0].result;
  assert.equal(typeof instructions, 'string');
  // A host that defers graft's schemas shows the model six bare names and nothing
  // else, so this string has to carry both the pitch and the recovery instruction.
  assert.match(instructions, /ONE lookup/, 'tells the agent to batch the schema fetch');
  assert.match(instructions, /select:mcp__graft__graft_find_code,/, 'gives a copy-pasteable query');
  for (const t of ['graft_find_code', 'graft_find_all', 'graft_trace_calls', 'graft_file_api', 'graft_repo_map']) {
    assert.ok(instructions.includes(t), `names ${t}`);
  }
  // Observed sibling servers sit at 660–984 chars; nothing proves a longer one
  // survives un-truncated, so hold the line here rather than discover it later.
  assert.ok(instructions.length < 1000, `instructions must stay under 1000 chars, got ${instructions.length}`);
  assert.match(serverInfo.version, /^\d+\.\d+\.\d+$/, 'real version, not the old hardcoded 0');
});

test('unknown method returns -32601', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'graft-mcpsrv2-'));
  const rs = await rpc([{ jsonrpc: '2.0', id: 9, method: 'resources/list' }], dir, 1);
  assert.equal(rs[0].error.code, -32601);
});
