/**
 * Bundles the viewer into dist/viewer/ (app.js via esbuild + copied static
 * assets). Runs as part of `npm run build`; the bundle ships in the package
 * so `graft viz` needs no install or build step at runtime.
 */
import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist", "viewer");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, "viewer", "main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: join(outDir, "app.js"),
});

for (const asset of ["index.html", "style.css"]) {
  copyFileSync(join(root, "viewer", asset), join(outDir, asset));
}

console.log("viewer bundle → dist/viewer/");
