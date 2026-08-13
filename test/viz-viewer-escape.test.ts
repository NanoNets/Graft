/**
 * Tests for the viewer's HTML escaping (viewer/escape.ts).
 *
 * `detail.ts` and `tree.ts` build markup as template strings and drop graph
 * values straight into double-quoted attributes. The escape they used to share
 * (copy-pasted into both files) handled `&` and `<` only, which is enough for
 * text and not for attributes: a `"` in a node id closes the attribute and
 * everything after it is parsed as more attributes.
 *
 * The values are not trustworthy: `src/viz/assemble.ts` lifts `slug` and
 * `relation` out of card frontmatter, i.e. LLM output written while summarizing
 * whatever repo graft was pointed at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../viewer/escape.js";

test("escapeHtml: a quote in a node id cannot break out of an attribute", () => {
  const hostile = 'x" onmouseover="alert(document.domain)" y="';
  const attr = `<button class="lnk" data-go="${escapeHtml(hostile)}">go</button>`;

  // The literal `"` must be gone — that is the whole exploit.
  assert.doesNotMatch(attr, /data-go="x" onmouseover=/);
  assert.match(attr, /data-go="x&quot; onmouseover=&quot;/);
  // Exactly three quote characters survive: the two around class="lnk" and…
  // the two around data-go. Four total, none of them from the payload.
  assert.equal(attr.split('"').length - 1, 4);
});

test("escapeHtml: covers every character that can change parsing, in both contexts", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  // & first, so an already-escaped-looking input doesn't come out double-decoded.
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  // A tag injected as text content stays inert too.
  assert.equal(escapeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  // Single-quoted attributes are safe for the same reason.
  assert.doesNotMatch(`<span title='${escapeHtml("a' onclick='alert(1)")}'>`, /' onclick='/);
});

test("escapeHtml: leaves ordinary graph ids and relation verbs completely alone", () => {
  for (const s of ["src/graph/build.ts#buildGraph", "Cache.get", "depends_on", "part of", "helper~2", ""])
    assert.equal(escapeHtml(s), s, `${s} must round-trip unchanged`);
});
