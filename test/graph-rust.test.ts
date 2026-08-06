import { test } from "node:test";
import assert from "node:assert/strict";
import Parser from "tree-sitter";
import Rust from "tree-sitter-rust/bindings/node/index.js";
import { collectBindings } from "../src/graph/bindings.js";
import { extractFile } from "../src/graph/extract.js";

test("Rust extraction: definitions, owners, module scopes, exports, and trait heritage", () => {
  const src = `
pub struct Cache<T> { value: T }
struct Private;
pub(self) struct SelfOnly;
pub(crate) enum Mode { Fast }
pub trait Backend<T> {
    fn required(&self);
    fn defaulted(&self) {}
}
pub type Alias = Cache<u8>;
pub union Bits { raw: u32 }

impl<T> Cache<T> {
    pub fn open(&self) {}
    pub(crate) fn crate_visible(&self) {}
    pub(self) fn self_only(&self) {}
    fn private(&self) {}
}

impl<T> Backend<T> for Cache<T> {
    fn required(&self) {}
}

#[macro_export]
macro_rules! exported_macro { () => {} }
macro_rules! local_macro { () => {} }

mod imp { pub fn open() {} }
#[cfg(test)]
mod tests { pub fn hidden() {} }
`;
  const { nodes, rawEdges } = extractFile("defs.rs", src, "rust");
  const byId = (id: string) => nodes.find((node) => node.id === id);

  assert.equal(byId("defs.rs#Cache")?.kind, "struct");
  assert.equal(byId("defs.rs#Private")?.kind, "struct");
  assert.equal(byId("defs.rs#SelfOnly")?.kind, "struct");
  assert.equal(byId("defs.rs#Mode")?.kind, "enum");
  assert.equal(byId("defs.rs#Backend")?.kind, "interface");
  assert.equal(byId("defs.rs#Alias")?.kind, "type");
  assert.equal(byId("defs.rs#Bits")?.kind, "struct");
  assert.equal(byId("defs.rs#exported_macro!")?.kind, "function");
  assert.equal(byId("defs.rs#local_macro!")?.kind, "function");

  assert.equal(byId("defs.rs#Cache.open")?.kind, "method");
  assert.equal(byId("defs.rs#Cache.open")?.owner, "Cache");
  assert.equal(byId("defs.rs#Cache.required")?.kind, "method");
  assert.equal(byId("defs.rs#Cache.required")?.owner, "Cache");
  assert.equal(byId("defs.rs#Backend.required")?.kind, "method");
  assert.equal(byId("defs.rs#Backend.required")?.owner, "Backend");
  assert.equal(byId("defs.rs#Backend.defaulted")?.owner, "Backend");
  assert.equal(byId("defs.rs#imp.open")?.kind, "function");
  assert.equal(byId("defs.rs#tests.hidden")?.exported, false);

  assert.equal(byId("defs.rs#Cache")?.exported, true);
  assert.equal(byId("defs.rs#Private")?.exported, false);
  assert.equal(byId("defs.rs#SelfOnly")?.exported, false);
  assert.equal(byId("defs.rs#Mode")?.exported, true);
  assert.equal(byId("defs.rs#Cache.open")?.exported, true);
  assert.equal(byId("defs.rs#Cache.crate_visible")?.exported, true);
  assert.equal(byId("defs.rs#Cache.self_only")?.exported, false);
  assert.equal(byId("defs.rs#Cache.private")?.exported, false);
  assert.equal(byId("defs.rs#Cache.required")?.exported, true);
  assert.equal(byId("defs.rs#Backend.required")?.exported, true);
  assert.equal(byId("defs.rs#exported_macro!")?.exported, true);
  assert.equal(byId("defs.rs#local_macro!")?.exported, false);

  assert.ok(
    rawEdges.some(
      (edge) =>
        edge.relation === "extends" &&
        edge.source === "defs.rs#Cache" &&
        edge.name === "Backend" &&
        edge.lang === "rust",
    ),
  );
});

test("Rust extraction: calls carry receiver types, module specifiers, macro namespaces, and guards", () => {
  const src = `
struct Worker<T> { value: T }
struct Factory;
fn bare<T>() {}
fn compute() {}

impl<T> Worker<T> {
    fn helper(&self) {}
    fn inside(&self) {
        Self::helper(self);
    }
}

fn exercise(param: &mut Worker<u8>, tuple: (fn(),)) {
    bare();
    bare::<u8>();
    let typed: &mut Worker<u8> = param;
    typed.run();
    typed.run::<u8>();
    param.run();
    let made = Factory::with_name();
    made.make();
    Worker::build();
    crate::worker::run();
    some_mod::run();
    super::run();
    tuple.0();
    println!("ignored");
    assert_eq!(compute(), 1);
    log_it!(compute());
}
`;
  const calls = extractFile("calls.rs", src, "rust").rawEdges.filter((edge) => edge.relation === "calls");
  const named = (name: string) => calls.filter((edge) => edge.name === name);

  assert.equal(named("bare").length, 2);
  assert.deepEqual(named("run").map((edge) => edge.recvType), ["Worker", "Worker", "Worker", undefined, undefined, undefined]);
  assert.deepEqual(named("run").slice(3).map((edge) => edge.specifier), ["crate::worker", "some_mod", "super"]);
  assert.ok(named("run").slice(0, 3).every((edge) => edge.viaMember));
  assert.ok(named("run").slice(3).every((edge) => !edge.viaMember));
  assert.equal(named("make")[0]?.recvType, "Factory");
  assert.equal(named("build")[0]?.recvType, "Worker");
  assert.equal(named("helper")[0]?.recvType, "Worker");
  assert.equal(named("log_it!").length, 1);
  assert.equal(named("println!").length, 0);
  assert.equal(named("assert_eq!").length, 0);
  assert.equal(named("compute").length, 0, "macro token trees stay opaque");
  assert.equal(named("0").length, 0, "tuple indexes are not method names");
  assert.ok(calls.every((edge) => edge.lang === "rust"));
});

test("Rust extraction: use forms retain full per-leaf paths and bodyless mods import", () => {
  const src = `
use foo;
use crate::models::Thing;
use crate::models::{Widget, helper, Thing as Renamed, self};
use crate::models::*;
use crate::Original as Alias;
mod x;
mod inline {
    mod leaf;
    pub fn nested() {}
}

fn uses() {
    let _a = Thing;
    let _b = Renamed;
    let _c = Alias;
    let _d = helper;
}
`;
  const { nodes, rawEdges } = extractFile("imports.rs", src, "rust");
  const imports = rawEdges.filter((edge) => edge.relation === "imports");
  assert.deepEqual(
    imports.map((edge) => edge.specifier),
    [
      "foo",
      "crate::models::Thing",
      "crate::models::Widget",
      "crate::models::helper",
      "crate::models::Thing",
      "crate::models::self",
      "crate::models::*",
      "crate::Original",
      "x",
      "inline::leaf",
    ],
  );
  assert.ok(imports.every((edge) => edge.lang === "rust"));
  assert.equal(nodes.find((node) => node.id === "imports.rs#inline.nested")?.kind, "function");

  const references = rawEdges.filter((edge) => edge.relation === "references");
  assert.deepEqual(
    references.map((edge) => ({ name: edge.name, specifier: edge.specifier })),
    [
      { name: "Thing", specifier: "crate::models::Thing" },
      { name: "Thing", specifier: "crate::models::Thing" },
      { name: "Original", specifier: "crate::Original" },
    ],
  );
  assert.ok(!references.some((edge) => edge.name === "helper"));
});

test("Rust bindings: typed lets, constructor lets, and typed parameters strip wrappers and generics", () => {
  const parser = new Parser();
  parser.setLanguage(Rust as never);
  const root = parser.parse(`
fn use_workers(param: &mut Worker<u8>) {
    let typed: &Worker<String> = param;
    let made = Factory::with_name();
}
`).rootNode;
  const bindings = collectBindings(root, "rust");

  assert.equal(bindings.lookup(["use_workers"], "param"), "Worker");
  assert.equal(bindings.lookup(["use_workers"], "typed"), "Worker");
  assert.equal(bindings.lookup(["use_workers"], "made"), "Factory");
});
