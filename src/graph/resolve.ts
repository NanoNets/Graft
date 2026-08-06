/**
 * Resolve {@link RawEdge} intents into concrete {@link EdgeV1} edges by matching
 * names/specifiers against the whole-repo node index.
 *
 * Confidence mirrors the SCIP/Graphify model:
 *   - `extracted`: the target is certain — a match within the same file, an
 *     import specifier, or a structural containment.
 *   - `inferred`: a bare function target was resolved by a unique name match
 *     across files, which name-shadowing could in principle fool.
 * Ambiguous cross-file matches (a name defined in several files) are dropped
 * rather than guessed. Member calls are stricter: they require a receiver type
 * and owner-qualified method match because a unique bare method name says
 * nothing about the receiver.
 */
import { posix } from "node:path";
import { toPosixPath } from "../util/paths.js";
import type { EdgeV1, Kind, NodeV1, Relation } from "./types.js";
import { languageOf, type Language, type RawEdge } from "./extract.js";
import { isTestPath } from "../util/testpath.js";

/** Extensions resolveImport tries for a same-directory, extensionless specifier.
 * Kept separate from {@link PS_IMPORT_EXTS} so the two module systems never
 * cross: a PS `Import-Module ./Widget` must not settle for a same-named
 * `Widget.ts`, and a TS `import "./Widget"` must not settle for a `Widget.psm1` —
 * each extensionless specifier only ever candidates through its OWN language's
 * source files. */
export const IMPORT_EXTS = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py",
];

const PS_IMPORT_EXTS = [".psm1", ".ps1"];

// The core PowerShell cmdlet/DSL surface (Microsoft.PowerShell.Core/Management/
// Utility/Security + Pester's own DSL) — ambient names that are never user-defined
// repo symbols, the same posture the resolver already takes for unresolvable
// member calls: drop rather than guess. `Get-ChildItem` called from prod code
// binding to the only in-repo def — a Pester mock — is a wrong edge, not a
// missing one; a dropped edge here is the safe failure mode.
// Lowercased so resolveName's PS path (already case-folding) can check it directly.
const PS_BUILTIN_CMDLETS: ReadonlySet<string> = new Set(
  [
    "Get-ChildItem", "Get-Content", "Set-Content", "Test-Path", "Join-Path", "Split-Path", "Resolve-Path",
    "Get-Item", "Set-Item", "Remove-Item", "New-Item", "Copy-Item", "Move-Item", "Rename-Item",
    "Write-Host", "Write-Output", "Write-Error", "Write-Warning", "Write-Verbose", "Write-Debug",
    "Write-Information", "Write-Progress", "Read-Host", "Out-File", "Out-Null", "Out-String",
    "Get-Command", "Get-Module", "Import-Module", "Remove-Module", "New-Module", "Get-Help",
    "Invoke-Expression", "Invoke-Command", "Invoke-WebRequest", "Invoke-RestMethod",
    "Start-Sleep", "Start-Process", "Stop-Process", "Get-Process",
    "Get-Service", "Start-Service", "Stop-Service", "Restart-Service",
    "Get-Date", "Get-Random", "Measure-Object", "Select-Object", "Where-Object", "ForEach-Object",
    "Sort-Object", "Group-Object", "Compare-Object", "Tee-Object", "New-Object", "Get-Member", "Add-Member",
    "Select-String", "Format-List", "Format-Table", "Format-Wide", "Format-Custom",
    "ConvertTo-Json", "ConvertFrom-Json", "ConvertTo-Csv", "ConvertFrom-Csv",
    "Export-Csv", "Import-Csv", "Export-Clixml", "Import-Clixml", "ConvertTo-Xml", "ConvertTo-Html",
    "Get-Location", "Set-Location", "Push-Location", "Pop-Location", "Test-Connection",
    "Get-Variable", "Set-Variable", "New-Variable", "Remove-Variable", "Clear-Variable",
    "Get-Alias", "Set-Alias", "New-Alias", "Get-PSDrive", "New-PSDrive", "Remove-PSDrive",
    "Get-ItemProperty", "Set-ItemProperty", "New-ItemProperty", "Remove-ItemProperty",
    "Get-EventLog", "Get-WmiObject", "Get-CimInstance", "Invoke-CimMethod", "Register-ObjectEvent",
    "Get-Job", "Start-Job", "Stop-Job", "Receive-Job", "Wait-Job", "Remove-Job",
    "Get-Credential", "ConvertTo-SecureString", "ConvertFrom-SecureString",
    "Get-ExecutionPolicy", "Set-ExecutionPolicy", "Get-Host", "Clear-Host", "Get-History",
    "Add-Type", "Update-TypeData", "Get-Unique", "Get-Culture", "Get-UICulture", "Get-TimeZone",
    "Set-StrictMode", "Wait-Process", "Exit-PSSession", "Enter-PSSession", "New-PSSession",
    "Remove-PSSession", "Get-PSSession", "Export-ModuleMember", "Set-PSDebug",
    "Register-EngineEvent", "Unregister-Event", "Get-Event", "New-TimeSpan", "New-Guid",
    // Pester DSL surface — ambient for graph purposes too (see rationale above).
    "Should", "Describe", "Context", "It", "BeforeAll", "BeforeEach", "AfterAll", "AfterEach", "Mock",
  ].map((n) => n.toLowerCase()),
);

/** A Go module discovered in the repo: its `module` path from `go.mod` and the repo
 * directory that `go.mod` lives in (posix, `.` for the repo root). A monorepo may hold
 * several — e.g. `backend/go.mod`, `tools/go.mod`. */
export interface GoModule {
  module: string;
  dir: string;
}

/** A Cargo package discovered in the repo: its `[package]` name and the
 * repo-relative directory containing Cargo.toml. */
export interface RustCrate {
  name: string;
  dir: string;
}

export interface ResolveOptions {
  /** The Go modules found in the repo. Enables mapping Go import package paths
   * (`example.com/app/pkg/util`) to the in-repo directory they name, relative to the
   * owning module's `go.mod` location. Empty/absent → Go imports stay external strings. */
  goModules?: GoModule[];
  /** Cargo packages found in the repo. Enables `crate::` and workspace-crate
   * module paths to resolve against source file nodes already present in byId. */
  rustCrates?: RustCrate[];
}

/** Bundled name-lookup indexes for {@link resolveName}: exact match and PS
 * case-folded match, each split into per-file and whole-repo. Bundled instead
 * of four positional params — the exact/folded pair each hold a structurally
 * identical `Map<string, Map<string, NodeV1[]>>` + `Map<string, NodeV1[]>`
 * shape, which a positional call site could swap without any type error.
 * `psTestPaths` is every PS node path classified by {@link isTestPath} —
 * used only to demote (never remove) test-path candidates at resolveName's two
 * global tiers. */
interface NameIndex {
  perFileName: Map<string, Map<string, NodeV1[]>>;
  globalName: Map<string, NodeV1[]>;
  rustGlobalName: Map<string, NodeV1[]>;
  psPerFileName: Map<string, Map<string, NodeV1[]>>;
  psGlobalName: Map<string, NodeV1[]>;
  psTestPaths: Set<string>;
}

/** Bundled owner/heritage indexes for {@link resolveTypedMember}: the
 * owner-qualified method indexes (`"Owner.method"` → candidates) and the
 * extends-chain indexes (class name → declared base names), domain-isolated
 * between non-PS exact and PS exact/case-folded lookups. Same swap-risk
 * rationale as {@link NameIndex}. */
interface OwnerIndex {
  ownerMethod: Map<string, NodeV1[]>;
  classParents: Map<string, string[]>;
  /** PowerShell-only exact-case owner-qualified method candidates. */
  psOwnerMethodExact: Map<string, NodeV1[]>;
  psOwnerMethod: Map<string, NodeV1[]>;
  psClassParents: Map<string, string[]>;
}

export function resolveEdges(
  nodes: NodeV1[],
  rawEdges: RawEdge[],
  opts: ResolveOptions = {},
): EdgeV1[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const globalName = new Map<string, NodeV1[]>();
  const rustGlobalName = new Map<string, NodeV1[]>();
  const perFileName = new Map<string, Map<string, NodeV1[]>>();
  const psGlobalName = new Map<string, NodeV1[]>();
  const psPerFileName = new Map<string, Map<string, NodeV1[]>>();
  // every PS node path that's itself a test path (Pester spec/mock file).
  const psTestPaths = new Set<string>();
  // Owner-qualified method index: "Owner.method" → candidate method nodes, for
  // typed member-call resolution (recvType + name → a specific class's method).
  const ownerMethod = new Map<string, NodeV1[]>();
  const psOwnerMethodExact = new Map<string, NodeV1[]>();
  const psOwnerMethod = new Map<string, NodeV1[]>();
  // Go package resolution: dir (posix) → its `.go` file node ids, for import mapping.
  const goFilesByDir = new Map<string, string[]>();
  const hasGoModules = !!opts.goModules?.length;
  for (const n of nodes) {
    if (n.kind === "file") {
      if (hasGoModules && n.path.endsWith(".go")) {
        const dir = posix.dirname(toPosixPath(n.path));
        push(goFilesByDir, dir, n.id);
      }
      continue;
    }
    if (isRustPath(n.path)) push(rustGlobalName, n.name, n);
    else push(globalName, n.name, n);
    let fileMap = perFileName.get(n.path);
    if (!fileMap) perFileName.set(n.path, (fileMap = new Map()));
    push(fileMap, n.name, n);
    if (isPsPath(n.path)) {
      push(psGlobalName, n.name.toLowerCase(), n);
      let psFileMap = psPerFileName.get(n.path);
      if (!psFileMap) psPerFileName.set(n.path, (psFileMap = new Map()));
      push(psFileMap, n.name.toLowerCase(), n);
      if (isTestPath(n.path)) psTestPaths.add(n.path);
    }
    if (n.kind === "method" && n.owner) {
      const key = `${n.owner}.${n.name}`;
      if (isPsPath(n.path)) {
        push(psOwnerMethodExact, key, n);
        push(psOwnerMethod, key.toLowerCase(), n);
      } else {
        push(ownerMethod, key, n);
      }
    }
  }

  // classParents: class/interface name → its declared base-class names, from raw
  // `extends` edges (source id's own name → the base name). Used to walk up an
  // inheritance chain when a receiver's own type has no matching method.
  const classParents = new Map<string, string[]>();
  const psClassParents = new Map<string, string[]>();
  for (const e of rawEdges) {
    if (e.relation !== "extends" || !e.name) continue;
    // The declaring class's own bare name — read from its node (keyed by n.name, set
    // once at mint time) rather than re-derived by slicing e.source, which breaks once
    // ids can carry a dedup ordinal (W2's `Cache~2`).
    const ownName = byId.get(e.source)?.name;
    if (!ownName) continue;
    if (e.lang === "powershell") {
      push(psClassParents, ownName.toLowerCase(), e.name.toLowerCase());
    } else {
      push(classParents, ownName, e.name);
    }
  }

  const nameIndex: NameIndex = {
    perFileName,
    globalName,
    rustGlobalName,
    psPerFileName,
    psGlobalName,
    psTestPaths,
  };
  const ownerIndex: OwnerIndex = { ownerMethod, classParents, psOwnerMethodExact, psOwnerMethod, psClassParents };
  // memoizes isTestPath(callerFile) across the whole rawEdges pass — many
  // edges share the same originating file.
  const callerIsTestCache = new Map<string, boolean>();

  const out: EdgeV1[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, relation: Relation, confidence: EdgeV1["confidence"]) => {
    const key = `${source}\0${relation}\0${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ source, target, relation, confidence });
  };

  for (const e of rawEdges) {
    if (e.relation === "contains" && e.targetId) {
      add(e.source, e.targetId, "contains", "extracted");
    } else if (e.relation === "imports" && e.specifier) {
      const target =
        hasGoModules && e.file.endsWith(".go")
          ? resolveGoImport(e.specifier, opts.goModules!, goFilesByDir)
          : resolveImport(e.specifier, e.file, byId, opts.rustCrates);
      add(e.source, target, "imports", "extracted");
    } else if (e.relation === "extends" || e.relation === "implements") {
      const kinds: Kind[] = e.relation === "implements" ? ["interface"] : ["class", "interface"];
      const hit = resolveName(e.name!, e.file, kinds, e.lang, nameIndex, callerIsTestCache);
      // an unresolved base is usually an external/imported type — keep the name.
      // (a demoted-then-still-ambiguous global tier lands here too —
      // node-target becomes raw-name fallback, same as any other miss. Harmless.)
      add(e.source, hit?.id ?? e.name!, e.relation, hit?.confidence ?? "inferred");
    } else if (e.relation === "references" && e.name && e.specifier) {
      // A named import gives both halves needed for sound resolution: the module
      // it came from and the exported name. Resolve inside that file only, so a
      // same-named symbol elsewhere in the repo cannot become a false edge.
      const targetFile = resolveImport(e.specifier, e.file, byId, opts.rustCrates);
      if (!byId.has(targetFile)) continue; // external or unresolved module
      const candidates = perFileName.get(targetFile)?.get(e.name) ?? [];
      if (candidates.length === 1) add(e.source, candidates[0].id, "references", "extracted");
    } else if (e.relation === "calls") {
      if (e.lang === "rust" && e.specifier) {
        const targetFile = resolveImport(e.specifier, e.file, byId, opts.rustCrates);
        if (!byId.has(targetFile)) continue;
        const candidates = (perFileName.get(targetFile)?.get(e.name!) ?? [])
          .filter((candidate) => candidate.kind === "function");
        if (candidates.length === 1) add(e.source, candidates[0].id, "calls", "extracted");
        continue;
      }
      if (e.viaMember) {
        if (!e.recvType) continue;
        const hit = resolveTypedMember(e.recvType, e.name!, e.file, e.lang, ownerIndex);
        if (hit === "ambiguous") continue; // drop — never guess past an ambiguous owner
        if (hit) add(e.source, hit.id, "calls", hit.confidence);
        // No owner-qualified match means the call is unresolved. A unique bare
        // method name is not evidence that this receiver has that method.
        continue;
      }
      const hit = resolveName(e.name!, e.file, ["function"], e.lang, nameIndex, callerIsTestCache);
      if (hit) add(e.source, hit.id, "calls", hit.confidence); // drop unresolved calls (too noisy)
    }
  }
  return out;
}

function isPsPath(path: string): boolean {
  return languageOf(path) === "powershell";
}

function isRustPath(path: string): boolean {
  return languageOf(path) === "rust";
}

function push<T>(map: Map<string, T[]>, key: string, val: T): void {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

/**
 * Resolve a bare symbol name: same-file match first (certain → `extracted`),
 * else a unique cross-file match (→ `inferred`), else null (ambiguous/unknown).
 *
 * PS edges consult the case-folded index within the SAME file before ever
 * looking cross-file: exact-local → folded-local → exact-global → folded-global.
 * Non-PS edges keep the plain exact-local → exact-global order (no folded tier).
 * Without this, a same-file case-insensitive match (e.g. A.ps1 calling `Foo` when
 * A.ps1 itself defines `foo`) lost to an unrelated exact-cased match in another
 * file (B.ps1's `Foo`) — local scope must win regardless of which tier finds it.
 *
 * Test-aware tie-break: Pester mocks routinely redeclare a prod name
 * across several `*.Tests.ps1` files; the never-guess ambiguity rule then
 * dropped EVERY cross-file call for that name (dbatools' Stop-Function: 2857
 * call sites, 0 edges — every candidate looked equally "ambiguous"). At the TWO
 * GLOBAL tiers ONLY (exact-global and folded-global, symmetrically) — never the
 * local tiers above, which already share the caller's own file — a PS caller
 * that ISN'T ITSELF a test file demotes test-path candidates before the
 * uniqueness check. Demotion breaks ties; it never removes the last candidate:
 * an empty filtered set falls back to the unfiltered one, so a symbol living
 * ONLY under a tests/ dir still resolves for a non-test caller. Deliberately
 * NOT applied in {@link resolveTypedMember} — that function has its own,
 * separate owner-qualified tie-breaking (an asymmetry, not an oversight). See
 * resolveEdges' extends/implements branch for the harmless fallback-to-raw-name
 * a demoted-then-still-ambiguous heritage edge takes.
 */
function resolveName(
  name: string,
  file: string,
  kinds: Kind[],
  lang: Language | undefined,
  { perFileName, globalName, rustGlobalName, psPerFileName, psGlobalName, psTestPaths }: NameIndex,
  callerIsTestCache: Map<string, boolean>,
): { id: string; confidence: EdgeV1["confidence"] } | null {
  const isPs = lang === "powershell";
  const localExact = perFileName.get(file)?.get(name) ?? [];
  const local = localExact.filter((n) => kinds.includes(n.kind) && (!isPs || isPsPath(n.path)));
  if (local.length) return { id: local[0].id, confidence: "extracted" };

  if (isPs) {
    const folded = name.toLowerCase();
    const psLocal = (psPerFileName.get(file)?.get(folded) ?? []).filter((n) => kinds.includes(n.kind));
    if (psLocal.length) return { id: psLocal[0].id, confidence: "extracted" };
  }

  // Builtin-cmdlet denylist sits AFTER both local tiers (a file that locally
  // redefines a builtin and calls it still self-links above) but BEFORE either
  // global tier — like test-demotion below, it guards only global lookups.
  if (isPs && PS_BUILTIN_CMDLETS.has(name.toLowerCase())) return null;

  if (lang === "rust") {
    const rustGlobal = (rustGlobalName.get(name) ?? []).filter((n) => kinds.includes(n.kind));
    return rustGlobal.length === 1 ? { id: rustGlobal[0].id, confidence: "inferred" } : null;
  }

  const demoteTestCandidates = (candidates: NodeV1[]): NodeV1[] => {
    if (!isPs) return candidates;
    let callerIsTest = callerIsTestCache.get(file);
    if (callerIsTest === undefined) {
      callerIsTest = isTestPath(file);
      callerIsTestCache.set(file, callerIsTest);
    }
    if (callerIsTest) return candidates; // a test caller's own ambiguity is untouched
    const nonTest = candidates.filter((n) => !psTestPaths.has(n.path));
    return nonTest.length ? nonTest : candidates; // empty-set fallback — never drop the last one
  };

  const globalExact = globalName.get(name) ?? [];
  const global = demoteTestCandidates(globalExact.filter((n) => kinds.includes(n.kind) && (!isPs || isPsPath(n.path))));
  if (global.length === 1) return { id: global[0].id, confidence: "inferred" };
  if (!isPs) return null;

  const folded = name.toLowerCase();
  const psGlobal = demoteTestCandidates((psGlobalName.get(folded) ?? []).filter((n) => kinds.includes(n.kind)));
  if (psGlobal.length === 1) return { id: psGlobal[0].id, confidence: "inferred" };
  return null;
}

/**
 * Resolve a typed member call (`recvType.name`) against the owner-qualified method
 * index, walking the receiver's extends chain when its own type has no match.
 *
 * Returns:
 *   - `{ id, confidence }` — resolved: a single candidate at some owner level (or the
 *     same-file one among several).
 *   - `"ambiguous"` — several candidates at some owner level and none is same-file;
 *     per the inviolable philosophy we drop and stop rather than guess, and we do
 *     NOT continue up the chain past this level.
 *   - `null` — the whole chain (recvType + ancestors, breadth-first, depth ≤ 3,
 *     cycle-guarded) had zero candidates at every level.
 *
 * PS edges check the same-file candidate before either index's cross-file result,
 * mirroring resolveName: exact-local → folded-local → exact-global → folded-global.
 * Non-PS edges keep the original exact-only lookup unchanged.
 */
function resolveTypedMember(
  recvType: string,
  name: string,
  file: string,
  lang: Language | undefined,
  { ownerMethod, classParents, psOwnerMethodExact, psOwnerMethod, psClassParents }: OwnerIndex,
): { id: string; confidence: EdgeV1["confidence"] } | "ambiguous" | null {
  const MAX_DEPTH = 3;
  const isPs = lang === "powershell";
  const visited = new Set<string>([isPs ? recvType.toLowerCase() : recvType]);
  let frontier = [recvType];
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth++) {
    if (lang === "rust") {
      const level = frontier.flatMap((type) =>
        (ownerMethod.get(`${type}.${name}`) ?? []).filter((candidate) => isRustPath(candidate.path)),
      );
      if (level.length > 1) return "ambiguous";
      if (level.length === 1) {
        const candidate = level[0];
        return { id: candidate.id, confidence: candidate.path === file ? "extracted" : "inferred" };
      }
    }
    for (const type of frontier) {
      if (lang === "rust") continue;
      const key = `${type}.${name}`;
      const exact = (isPs ? psOwnerMethodExact : ownerMethod).get(key) ?? [];

      if (!isPs) {
        if (!exact.length) continue; // try next ancestor
        if (exact.length === 1) {
          const c = exact[0];
          return { id: c.id, confidence: c.path === file ? "extracted" : "inferred" };
        }
        const sameFile = exact.find((c) => c.path === file);
        if (sameFile) return { id: sameFile.id, confidence: "extracted" };
        return "ambiguous"; // several, none same-file — drop and stop
      }

      const folded = psOwnerMethod.get(key.toLowerCase()) ?? [];
      const exactLocal = exact.filter((c) => c.path === file);
      if (exactLocal.length) return { id: exactLocal[0].id, confidence: "extracted" };
      const foldedLocal = folded.filter((c) => c.path === file);
      if (foldedLocal.length) return { id: foldedLocal[0].id, confidence: "extracted" };

      const candidates = exact.length ? exact : folded;
      if (!candidates.length) continue; // try next ancestor
      if (candidates.length === 1) return { id: candidates[0].id, confidence: "inferred" };
      return "ambiguous"; // several, none same-file at this level — drop and stop
    }
    const next: string[] = [];
    for (const type of frontier) {
      const parents = isPs ? (psClassParents.get(type.toLowerCase()) ?? []) : (classParents.get(type) ?? []);
      for (const parent of parents) {
        const key = isPs ? parent.toLowerCase() : parent;
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(parent);
      }
    }
    frontier = next;
  }
  return null; // chain exhausted, no candidate anywhere
}

/**
 * Resolve a module specifier to a file node id when it points inside the repo;
 * otherwise return the raw specifier (external package or unresolved path).
 *
 * `$PSScriptRoot` is PowerShell's own-directory literal — the equivalent of
 * TS's `./`. Gated on the FILE's language (via `languageOf`, not a `lang` param —
 * this function isn't threaded one, and the file's own extension is the only
 * signal it needs), a `$PSScriptRoot/`-prefixed specifier is rewritten to a
 * relative `rel` and resolved through the same machinery below as any other
 * relative specifier. BOTH failure returns below return the ORIGINAL `spec`,
 * never `rel` — an unresolved rewrite must not masquerade as a repo path.
 * KNOWN ACCEPTED LIMITATION: a function DEFINED in a dot-sourced file but
 * EXECUTED later resolves `$PSScriptRoot` to the CALLER's directory at
 * runtime; we wire it to the DEFINING file's directory instead.
 */
function resolveImport(
  spec: string,
  file: string,
  byId: Map<string, NodeV1>,
  rustCrates?: RustCrate[],
): string {
  if (languageOf(file) === "rust") return resolveRustImport(spec, file, byId, rustCrates ?? []);
  const isPs = languageOf(file) === "powershell";
  const rel = isPs ? spec.replace(/^\$psscriptroot\//i, "./") : spec;
  if (!rel.startsWith(".")) return spec;
  // Belt-and-braces: `node.path` is posix by construction (`../util/paths.ts`),
  // but this also accepts a hand-written or hand-edited graph.
  const dir = posix.dirname(toPosixPath(file));
  const base = posix.normalize(posix.join(dir, rel));
  const noExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx|py|ps1|psm1)$/, "");
  // The specifier's own file decides which extensions are even candidates — see
  // IMPORT_EXTS' doc comment for why the two lists must never mix.
  const exts = isPs ? PS_IMPORT_EXTS : IMPORT_EXTS;
  const candidates = [
    base,
    ...exts.map((e) => noExt + e),
    ...exts.map((e) => `${noExt}/index${e}`),
    // PowerShell's directory-module convention — `Modules/Foo` names a
    // directory whose module file shares the directory's own basename
    // (`Modules/Foo/Foo.psm1`), unlike JS's `index` convention.
    ...(isPs ? exts.map((e) => `${noExt}/${posix.basename(noExt)}${e}`) : []),
  ];
  for (const c of candidates) if (byId.has(c)) return c;
  return spec;
}

/** A Rust module's child directory. Crate-root files and mod.rs own their
 * containing directory; every other module file owns a same-named directory. */
function rustModuleDir(file: string): string {
  const normalized = toPosixPath(file);
  const dir = posix.dirname(normalized);
  const base = posix.basename(normalized);
  if (
    base === "lib.rs" ||
    base === "main.rs" ||
    base === "mod.rs" ||
    isRustAuxiliaryCrateRoot(normalized)
  ) {
    return dir;
  }
  return posix.join(dir, base.slice(0, -3));
}

function isRustAuxiliaryCrateRoot(file: string): boolean {
  return /(?:^|\/)(?:tests|benches|examples)\/[^/]+\.rs$/.test(toPosixPath(file));
}

function rustCrateSrcDir(crate: RustCrate): string {
  return crate.dir === "." ? "src" : posix.join(crate.dir, "src");
}

function pathIsWithin(path: string, dir: string): boolean {
  return dir === "." || path === dir || path.startsWith(`${dir}/`);
}

function rustCrateRoot(crate: RustCrate, byId: Map<string, NodeV1>): string | null {
  const srcDir = rustCrateSrcDir(crate);
  const lib = posix.join(srcDir, "lib.rs");
  if (byId.has(lib)) return lib;
  const main = posix.join(srcDir, "main.rs");
  return byId.has(main) ? main : null;
}

function owningRustCrate(file: string, crates: RustCrate[]): RustCrate | null {
  const normalized = toPosixPath(file);
  let best: { crate: RustCrate; prefixLength: number } | null = null;
  for (const crate of crates) {
    const srcDir = rustCrateSrcDir(crate);
    const prefix = pathIsWithin(normalized, srcDir)
      ? srcDir
      : pathIsWithin(normalized, crate.dir)
        ? crate.dir
        : null;
    if (prefix === null) continue;
    if (!best || prefix.length > best.prefixLength) best = { crate, prefixLength: prefix.length };
  }
  return best?.crate ?? null;
}

function matchingRustCrate(segment: string, crates: RustCrate[]): RustCrate | null {
  const normalized = segment.replace(/-/g, "_");
  return crates.find((crate) => crate.name.replace(/-/g, "_") === normalized) ?? null;
}

function resolveRustModule(
  baseDir: string,
  segments: string[],
  byId: Map<string, NodeV1>,
): string | null {
  for (let length = segments.length; length >= 1; length--) {
    const stem = posix.join(baseDir, ...segments.slice(0, length));
    const flat = `${stem}.rs`;
    if (byId.has(flat)) return flat;
    const nested = posix.join(stem, "mod.rs");
    if (byId.has(nested)) return nested;
  }
  return null;
}

function resolveRustImport(
  spec: string,
  file: string,
  byId: Map<string, NodeV1>,
  crates: RustCrate[],
): string {
  const segments = spec.split("::").filter(Boolean);
  if (segments.length === 0) return spec;

  let baseDir: string;
  let remaining: string[];
  let rootFile: string | null = null;
  if (segments[0] === "crate") {
    if (isRustAuxiliaryCrateRoot(file)) {
      rootFile = toPosixPath(file);
      baseDir = posix.dirname(rootFile);
    } else {
      const crate = owningRustCrate(file, crates);
      if (!crate) return spec;
      rootFile = rustCrateRoot(crate, byId);
      if (!rootFile) return spec;
      baseDir = rustCrateSrcDir(crate);
    }
    remaining = segments.slice(1);
  } else if (segments[0] === "self") {
    baseDir = rustModuleDir(file);
    remaining = segments.slice(1);
  } else if (segments[0] === "super") {
    baseDir = rustModuleDir(file);
    let index = 0;
    while (segments[index] === "super") {
      baseDir = posix.dirname(baseDir);
      index++;
    }
    remaining = segments.slice(index);
  } else {
    const crate = matchingRustCrate(segments[0], crates);
    if (crate) {
      rootFile = rustCrateRoot(crate, byId);
      if (!rootFile) return spec;
      baseDir = rustCrateSrcDir(crate);
      remaining = segments.slice(1);
    } else if (segments.length === 1) {
      // Bodyless `mod x;` has no syntactic marker by resolution time, but its
      // single-segment shape is enough to try the declaring module's child dir.
      baseDir = rustModuleDir(file);
      remaining = segments;
    } else {
      return spec;
    }
  }

  if (remaining.length === 0) return rootFile ?? spec;
  return resolveRustModule(baseDir, remaining, byId) ?? spec;
}

/**
 * Resolve a Go import package path to an in-repo file node when it points inside one of
 * the repo's modules; otherwise return the raw specifier (stdlib or third-party package).
 *
 * Go imports name a *package* (a directory), not a file. The package path is relative to
 * the owning module's path, so the in-repo directory is `<module go.mod dir>/<subpath>`.
 * This handles a `go.mod` anywhere in the tree — repo root or a subdirectory (monorepo).
 * When several modules' paths prefix the spec, the longest (most specific) wins. A package
 * dir may hold several `.go` files; we pick a deterministic representative (lowest id).
 */
function resolveGoImport(spec: string, modules: GoModule[], filesByDir: Map<string, string[]>): string {
  let best: { mod: GoModule; subpath: string } | null = null;
  for (const mod of modules) {
    let subpath: string | null = null;
    if (spec === mod.module) subpath = "";
    else if (spec.startsWith(mod.module + "/")) subpath = spec.slice(mod.module.length + 1);
    if (subpath === null) continue;
    if (!best || mod.module.length > best.mod.module.length) best = { mod, subpath };
  }
  if (!best) return spec; // stdlib / third-party — keep the package path

  const dir = posix.normalize(posix.join(best.mod.dir, best.subpath));
  const files = filesByDir.get(dir);
  if (!files || files.length === 0) return spec;
  return [...files].sort()[0];
}
