/**
 * Modular ignore rules categorized by ecosystem / language context.
 *
 * Used by filesystem walking (`fs.ts`) and scope discovery (`scopes.ts`) to
 * exclude build outputs, dependency directories, bytecode, and non-source files.
 */
import ignore, { type Ignore } from "ignore";

export interface IgnoreGroup {
  /** Stable identifier for the ecosystem group. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Directory names or relative path patterns to skip. */
  dirs: ReadonlyArray<string>;
  /** Non-source file extension or pattern rules to skip. */
  patterns: ReadonlyArray<string>;
}

export const GENERAL_IGNORE_GROUP: IgnoreGroup = {
  id: "general",
  name: "General & Universal",
  dirs: [],
  patterns: [
    "*.exe", "*.dll", "*.so", "*.dylib",
    "*.zip", "*.tar", "*.gz", "*.7z", "*.rar",
    "*.pdf", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.ico", "*.svg",
    "*.mp3", "*.mp4", "*.mov", "*.db", "*.sqlite",
  ],
};

export const NPM_JS_IGNORE_GROUP: IgnoreGroup = {
  id: "npm",
  name: "NPM / JavaScript / TypeScript",
  dirs: [
    "node_modules", "dist", "build", "out", "coverage",
    ".next", ".nuxt", ".turbo", ".output", ".parcel-cache",
  ],
  patterns: [
    "node_modules/", "dist/", "build/", "out/", "coverage/",
    ".next/", ".nuxt/", ".turbo/", ".output/", ".parcel-cache/",
    "*.min.js", "*.min.css", "*.js.map", "*.css.map",
  ],
};

export const PYTHON_IGNORE_GROUP: IgnoreGroup = {
  id: "python",
  name: "Python",
  dirs: [
    "__pycache__", "venv", ".venv", "env", ".env", "virtualenv",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", "htmlcov",
    ".eggs", "eggs", "*.egg-info",
  ],
  patterns: [
    "__pycache__/", "venv/", ".venv/", "env/", ".env/", "virtualenv/",
    ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".tox/", "htmlcov/",
    ".eggs/", "eggs/", "*.egg-info/",
    "*.pyc", "*.pyo", "*.pyd",
  ],
};

export const KOTLIN_GRADLE_IGNORE_GROUP: IgnoreGroup = {
  id: "kotlin-gradle",
  name: "Kotlin / Gradle / Java",
  dirs: [
    "build", ".gradle", "out", "target", ".idea", ".apt_generated", "bin",
  ],
  patterns: [
    "build/", ".gradle/", "out/", "target/", ".idea/", ".apt_generated/", "bin/",
    "*.class", "*.jar", "*.aar", "*.war", "*.ear", "*.klib",
  ],
};

export const DART_FLUTTER_IGNORE_GROUP: IgnoreGroup = {
  id: "dart-flutter",
  name: "Dart / Flutter",
  dirs: [
    ".dart_tool", ".pub-cache", ".pub", "build", "ephemeral", "ios/Pods", ".fvm",
  ],
  patterns: [
    ".dart_tool/", ".pub-cache/", ".pub/", "build/", "ephemeral/", "ios/Pods/", ".fvm/",
    ".flutter-plugins", ".flutter-plugins-dependencies",
  ],
};

export const GO_IGNORE_GROUP: IgnoreGroup = {
  id: "go",
  name: "Go",
  dirs: ["vendor", "bin"],
  patterns: ["vendor/", "bin/", "*.a", "*.o"],
};

export const ALL_IGNORE_GROUPS: ReadonlyArray<IgnoreGroup> = [
  GENERAL_IGNORE_GROUP,
  NPM_JS_IGNORE_GROUP,
  PYTHON_IGNORE_GROUP,
  KOTLIN_GRADLE_IGNORE_GROUP,
  DART_FLUTTER_IGNORE_GROUP,
  GO_IGNORE_GROUP,
];

/** Combined directory names set for fast lookup and backward compatibility. */
export const SKIP_DIRS: Set<string> = new Set<string>(
  ALL_IGNORE_GROUPS.flatMap((g) => g.dirs),
);

/**
 * Returns a new `Ignore` instance pre-loaded with pattern rules from all default ecosystem groups.
 */
export function createDefaultIgnore(): Ignore {
  const ig = ignore();
  for (const group of ALL_IGNORE_GROUPS) {
    if (group.patterns.length > 0) {
      ig.add(group.patterns as string[]);
    }
  }
  return ig;
}
