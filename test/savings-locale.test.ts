/**
 * #338: graft rendered its savings footer with the machine's locale and read it
 * back with a regex that knows only `,`, so a `de-DE`/`tr-TR` box wrote `1.990`
 * and parsed it as `1`.
 *
 * A process cannot change its own ambient locale — Node takes it from the
 * environment on posix and from the OS on Windows — so these tests move the
 * *default* instead: `toLocaleString()` with no argument answers the way a
 * `.`-grouping locale would, while calls that name a locale are left alone.
 * That is exactly the difference the fix turns on, and it behaves identically on
 * an en-US CI runner, which is why CI never caught the original.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savingsLine, sumSavingsFooters } from '../src/context/savings.js';
import { formatSessionStats } from '../src/claude/session-metrics.js';

/** Run `fn` on a machine whose default locale groups thousands with `locale`'s
 *  separator. Restores the real method even if `fn` throws. */
function withDefaultLocale<T>(locale: string, fn: () => T): T {
  const real = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (
    this: number,
    locales?: string | string[],
    options?: Intl.NumberFormatOptions,
  ): string {
    return real.call(this, locales ?? locale, options);
  };
  try {
    return fn();
  } finally {
    Number.prototype.toLocaleString = real;
  }
}

test('#338: the savings footer round-trips on a machine that is not en-US', () => {
  // Sanity: the stand-in really does change what an unqualified call renders,
  // or the rest of this file would pass for the wrong reason.
  assert.equal(withDefaultLocale('de-DE', () => (1990).toLocaleString()), '1.990');

  const line = withDefaultLocale('de-DE', () => savingsLine('x'.repeat(40), { files: 2, baselineChars: 8000 }));
  assert.match(line, /tokens saved ≈ 1,990/, 'grouped for the reader, not for the machine');
  assert.equal(sumSavingsFooters(line), 1990, 'and read back whole, not as its first group');
});

test('#338: what graft displays groups the same way as what it parses', () => {
  const out = withDefaultLocale('de-DE', () =>
    formatSessionStats({ id: 'abc', perAgentQuery: {}, graftReads: 8, sourceReads: 2, savedTokens: 12345 }),
  );
  assert.match(out, /tokens saved:\s+~12,345/);
});
