/**
 * HTML escaping for the two views that still build markup as strings
 * (`detail.ts`, `tree.ts`).
 *
 * The old per-file version escaped `&` and `<` only, which is enough for text
 * nodes and NOT enough here: every value is interpolated inside a
 * double-quoted attribute (`data-go="…"`, `data-id="…"`, `style="…"`). A single
 * `"` in a node id closes the attribute early and the rest of the id is parsed
 * as more attributes — `x" onmouseover="alert(1)` becomes a live event handler
 * on a button the user is being invited to click.
 *
 * The ids were treated as trusted because they come from graft's own output,
 * but that trust never held: `assemble.ts` reads `slug` and `relation` straight
 * out of card frontmatter, which an LLM wrote while summarizing a repo that may
 * be anyone's. A prompt-injected slug is a plausible delivery path, and the
 * viewer serves the private graph of the repo it is pointed at.
 *
 * `'` and `>` are escaped too, so the same function is correct for
 * single-quoted attributes and for text content, and nobody has to remember
 * which context they are in.
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
