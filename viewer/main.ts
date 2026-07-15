/**
 * graft viz — viewer entry point. Wires tabs, chips, legend, search, theme,
 * SSE live reload, and the three views (Context graph / Code graph / Outline).
 */
import { loadContextGraph, loadCodeGraph, onServerChange, chipKey, CHIP_HINT, colorToken, cvar, famOf, type VizGraph } from "./data.js";
import { GraphView } from "./graph.js";
import { renderDetail } from "./detail.js";
import { renderOutline } from "./tree.js";

type Tab = "context" | "code" | "outline";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const state = {
  tab: "context" as Tab,
  context: null as VizGraph | null,
  code: null as VizGraph | null,
  outlineOpen: {} as Record<string, boolean>,
};

const view = new GraphView($("graphSvg") as unknown as SVGSVGElement);

function activeGraph(): VizGraph | null {
  return state.tab === "context" ? state.context : state.code;
}

function graphTab(): "context" | "code" {
  return state.tab === "code" || state.tab === "outline" ? "code" : "context";
}

/* ---------- chips: verbs actually present, grouped only where obvious ---------- */
function renderChips(): void {
  const host = $("edgeChips");
  host.innerHTML = '<span class="cap">Edges</span>';
  const graph = activeGraph();
  if (!graph) return;
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    const key = chipKey(e.relation);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...counts.keys()].sort((a, b) => {
    const rank = (k: string) => (k === "part of" ? 0 : k === "uses" ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const key of keys) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "echip" + (view.hiddenRels[key] ? "" : " on");
    btn.innerHTML = `${glyphFor(key)} ${key} <span style="opacity:.55">${counts.get(key)}</span>`;
    btn.title = (CHIP_HINT[key] ?? `"${key}" edges`) + " — click to " + (view.hiddenRels[key] ? "show" : "hide");
    btn.addEventListener("click", () => {
      view.hiddenRels[key] = !view.hiddenRels[key];
      renderChips();
      view.restyle();
      updateShownCount();
    });
    host.appendChild(btn);
  }
}

function glyphFor(key: string): string {
  const fam = key === "part of" ? "structure" : key === "uses" ? "dependency" : famOf(key.replace(/ /g, "_"));
  const glyphs: Record<string, string> = {
    structure: '<svg width="20" height="8" aria-hidden="true"><line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" stroke-width="3" opacity=".5"/></svg>',
    dependency: '<svg width="20" height="8" aria-hidden="true"><line x1="1" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.6"/><path d="M14,1 L19,4 L14,7 z" fill="currentColor"/></svg>',
    contract: '<svg width="20" height="8" aria-hidden="true"><line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.4"/><path d="M13,1 L19,4 L13,7 z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    association: '<svg width="20" height="8" aria-hidden="true"><line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 4" opacity=".7"/></svg>',
  };
  return glyphs[fam];
}

/* ---------- node-type legend ---------- */
function renderLegend(): void {
  const host = $("legend");
  host.innerHTML = "";
  const graph = activeGraph();
  if (!graph) return;
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  for (const [type, count] of counts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lchip" + (view.hiddenTypes[type] ? " off" : "");
    chip.innerHTML = `<span class="sw" style="background:${cvar(colorToken(graphTab(), type))}"></span>${type} <span style="color:var(--muted);font-weight:500">${count}</span>`;
    chip.addEventListener("click", () => {
      view.hiddenTypes[type] = !view.hiddenTypes[type];
      renderLegend();
      view.restyle();
      updateShownCount();
    });
    host.appendChild(chip);
  }
}

function updateShownCount(): void {
  const graph = activeGraph();
  if (!graph) { $("lcount").textContent = ""; return; }
  const shown = graph.nodes.filter((n) => !view.hiddenTypes[n.type]).length;
  $("lcount").textContent = `${shown} / ${graph.nodes.length} nodes shown`;
}

function updateCounts(): void {
  const el = $("counts");
  if (state.tab === "outline" && state.code) {
    const files = state.code.nodes.filter((n) => n.type === "file").length;
    el.textContent = `${files} files · ${state.code.nodes.length} symbols`;
  } else {
    const graph = activeGraph();
    el.textContent = graph ? `${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} links` : "";
  }
}

/* ---------- detail panel ---------- */
function showDetail(id: string | null): void {
  renderDetail($("detail"), state.tab === "context" ? state.context : state.code, graphTab(), id, (next) => {
    if (state.tab === "outline") {
      showDetail(next);
      renderOutline($("tree"), state.code!, next, state.outlineOpen, showDetail);
    } else {
      view.focus(next);
    }
  });
}

view.onSelect = (id) => showDetail(id);

/* ---------- tabs ---------- */
function setTab(tab: Tab): void {
  state.tab = tab;
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => {
    b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
  });
  const isOutline = tab === "outline";
  $("canvasWrap").hidden = isOutline;
  $("outlineView").hidden = !isOutline;
  view.hiddenRels = {};
  view.hiddenTypes = {};
  view.selected = null;
  showDetail(null);

  const empty = $("graphEmpty");
  if (tab === "outline") {
    if (state.code) renderOutline($("tree"), state.code, null, state.outlineOpen, showDetail);
    else {
      $("outlineView").hidden = true;
      $("canvasWrap").hidden = false;
      showEmpty("No code graph yet — run <code>graft graph</code> to generate <span class=\"mono\">graph.json</span>.");
    }
  } else {
    const graph = activeGraph();
    if (!graph) {
      showEmpty(tab === "code"
        ? "No code graph yet — run <code>graft graph</code> to generate <span class=\"mono\">graph.json</span>."
        : "No context graph — run <code>graft init</code> first.");
    } else {
      empty.hidden = true;
      view.resetView();
      view.setData(graph, graphTab());
      view.reheat();
    }
  }
  renderChips();
  renderLegend();
  updateShownCount();
  updateCounts();
}

function showEmpty(html: string): void {
  const empty = $("graphEmpty");
  empty.innerHTML = html;
  empty.hidden = false;
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => {
  b.addEventListener("click", () => setTab(b.dataset.tab as Tab));
});

/* ---------- search ---------- */
const search = $("search") as HTMLInputElement;
search.addEventListener("input", () => {
  view.query = search.value.trim();
  view.restyle();
});
search.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && view.query) {
    const hit = view.firstMatch();
    if (hit) view.focus(hit.id);
  }
});

/* ---------- zoom controls ---------- */
$("zin").addEventListener("click", () => view.zoomBy(1.25));
$("zout").addEventListener("click", () => view.zoomBy(1 / 1.25));
$("zreset").addEventListener("click", () => view.resetView());

/* ---------- theme ---------- */
const THEME_KEY = "graft-viz-theme";
const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
$("themeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = current ? current === "dark" : systemDark;
  const next = isDark ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  view.restyle();
  renderChips();
  renderLegend();
  showDetail(view.selected);
});

/* ---------- data loading + live reload ---------- */
async function loadAll(): Promise<void> {
  const [context, code] = await Promise.all([loadContextGraph(), loadCodeGraph()]);
  state.context = context;
  state.code = code;
  $("repoName").textContent = context.meta.repoName ?? "";
  document.title = `graft viz — ${context.meta.repoName ?? ""}`;
  setTab(state.tab);
}

onServerChange(() => {
  const selected = view.selected;
  void loadAll().then(() => {
    if (selected) { view.selected = selected; view.restyle(); showDetail(selected); }
  });
});

void loadAll();
