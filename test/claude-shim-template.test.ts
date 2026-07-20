import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { statuslineShim, hooksShim } from '../src/claude/shim-template.js';

for (const [name, src] of [['statusline', statuslineShim()], ['hooks', hooksShim()]] as const) {
  test(`${name} shim parses and resolves local + global, with local fallback`, () => {
    const body = src.replace(/^#!.*\n/, ''); // strip shebang for vm
    assert.doesNotThrow(() => new vm.Script(body), 'valid JS');
    assert.match(src, /require\.resolve\('@nanonets\/graft\/package\.json', \{ paths: \[base\] \}\)/);
    assert.match(src, /const globalBase = path\.join\(path\.dirname\(process\.execPath\), '\.\.', 'lib'\)/);
    assert.match(src, /for \(const base of \[dir, globalBase\]\)/);
    assert.match(src, /path\.join\(dir, 'dist', 'claude'/);
    assert.match(src, /\.catch\(\(\) => \{/); // best-effort
  });
}

test('statusline calls main(); hooks passes the event arg', () => {
  assert.match(statuslineShim(), /m\.main\(\)/);
  assert.match(hooksShim(), /m\.main\(process\.argv\[2\]\)/);
});
