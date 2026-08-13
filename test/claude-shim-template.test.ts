import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { statuslineShim, hooksShim } from '../src/claude/shim-template.js';

const BAKED = '/opt/graft/dist/claude';

for (const [name, src] of [['statusline', statuslineShim(BAKED)], ['hooks', hooksShim(BAKED)]] as const) {
  test(`${name} shim parses and knows all four candidates (baked, node_modules, lib, npm root -g)`, () => {
    const body = src.replace(/^#!.*\n/, ''); // strip shebang for vm
    assert.doesNotThrow(() => new vm.Script(body), 'valid JS');

    // 1. baked dir is present as the first candidate
    assert.match(src, new RegExp(`const BAKED = "${BAKED}"`));
    // 2. repo node_modules via require.resolve from the project dir
    assert.match(src, /require\.resolve\('@nanonets\/graft\/package\.json', \{ paths: \[base\] \}\)/);
    assert.match(src, /fromPkg\(dir\)/);
    // 3. legacy execPath/../lib guess retained
    assert.match(src, /path\.join\(path\.dirname\(process\.execPath\), '\.\.', 'lib'\)/);
    // 4. npm root -g, now compared alongside the others rather than used as a
    //    fallback behind them — see the header comment in shim-template.ts.
    assert.match(src, /execFileSync\('npm', \['root', '-g'\]/);
    // Its answer is cached for a day under the user's own home, never in a
    // world-writable temp dir a co-tenant could point at their own code.
    assert.match(src, /os\.homedir\(\), '\.graft', 'npm-root\.json'/);
    assert.doesNotMatch(src, /tmpdir/);

    // Highest version wins among the candidates, not first-hit — otherwise the
    // baked path pins the user to whatever graft wired the repo, forever.
    // Behaviour is exercised for real in claude-shim-resolve.test.ts.
    assert.match(src, /function best\(dirs, name\)/);
    assert.match(src, /'package\.json'/); // versionOf reads each candidate's version

    // Windows-safe dynamic import + best-effort catch
    assert.match(src, /pathToFileURL\(entry\(/);
    assert.match(src, /\.catch\(\(\) => \{/);
  });
}

test('the shims this repo commits carry no home directory and are the current template', () => {
  // These two files are in `git ls-files`, and .claude/settings.json — also
  // committed — points every hook and the statusline at them, so they cannot just
  // be gitignored: a clone without them fails with "Cannot find module". They were
  // checked in with `/Users/<someone>/…` baked in and a pre-0.11 first-hit body,
  // which is the scar the header comment in mcp-config.ts refuses to repeat.
  for (const [file, expected] of [
    ['graft-hooks.cjs', hooksShim('dist/claude')],
    ['graft-statusline.cjs', statuslineShim('dist/claude')],
  ] as const) {
    // Compare content, not line endings: git checks these out as CRLF wherever
    // core.autocrlf is on (every default Windows install), and the template only
    // ever emits \n. Without this the guard fails for contributors whose shims
    // are perfectly up to date.
    const text = readFileSync(new URL(`../.claude/helpers/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.doesNotMatch(text, /\/Users\/|C:\\+Users\\+|\/home\//, `${file} has a machine's home directory in it`);
    assert.equal(text, expected, `${file} is out of date — regenerate it from shim-template.ts`);
  }
});

test('statusline calls main(); hooks passes the event arg', () => {
  assert.match(statuslineShim(BAKED), /m\.main\(\)/);
  assert.match(hooksShim(BAKED), /m\.main\(process\.argv\[2\]\)/);
});
