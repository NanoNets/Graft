/**
 * Outline view: the code graph's `contains` hierarchy (file → class → method)
 * as a collapsible tree with kind dots and per-file symbol counts.
 */
import { type VizGraph, colorToken, cvar } from "./data.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export function renderOutline(
  host: HTMLElement,
  graph: VizGraph,
  selected: string | null,
  openState: Record<string, boolean>,
  onSelect: (id: string) => void,
): void {
  const kids = (pid: string) =>
    graph.edges
      .filter((e) => e.relation === "contains" && e.source === pid)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const countDesc = (pid: string): number => {
    const k = kids(pid);
    return k.length + k.reduce((sum, c) => sum + countDesc(c.id), 0);
  };
  const files = graph.nodes.filter((n) => n.type === "file");

  const row = (node: (typeof files)[number]): string => {
    const children = kids(node.id);
    const open = openState[node.id] !== false;
    let html = `<button class="tree-row${open ? " open" : ""}${selected === node.id ? " sel" : ""}"` +
      ` data-id="${esc(node.id)}" data-haskids="${children.length ? 1 : 0}">` +
      `<span class="chev">${children.length ? "▶" : ""}</span>` +
      `<span class="k" style="background:${cvar(colorToken("code", node.type))}"></span>` +
      `<span class="t${node.type === "file" ? " mono" : ""}">${esc(node.name)}</span>` +
      `<span class="badge">${children.length ? countDesc(node.id) + " sym" : esc(node.type)}</span></button>`;
    if (children.length && open) {
      html += `<div class="tree-kids">${children.map(row).join("")}</div>`;
    }
    return html;
  };

  host.innerHTML =
    '<div class="tree-tools"><button data-tool="expand">Expand all</button><button data-tool="collapse">Collapse all</button></div>' +
    files.map(row).join("");

  host.querySelectorAll<HTMLButtonElement>(".tree-row").forEach((r) => {
    r.addEventListener("click", () => {
      const id = r.dataset.id!;
      if (r.dataset.haskids === "1") {
        openState[id] = openState[id] === false;
        renderOutline(host, graph, id, openState, onSelect);
      }
      onSelect(id);
    });
  });
  host.querySelector<HTMLButtonElement>('[data-tool="expand"]')?.addEventListener("click", () => {
    for (const key of Object.keys(openState)) delete openState[key];
    renderOutline(host, graph, selected, openState, onSelect);
  });
  host.querySelector<HTMLButtonElement>('[data-tool="collapse"]')?.addEventListener("click", () => {
    for (const n of graph.nodes) openState[n.id] = false;
    renderOutline(host, graph, selected, openState, onSelect);
  });
}
