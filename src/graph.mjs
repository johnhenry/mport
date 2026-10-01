// Whole-graph integrity. `verified()` hashes the one file a specifier resolves to, and
// on esm.sh that file is a stub that re-imports "/react@19.2.0/es2022/react.mjs": the
// bytes that matter are one hop away. This walks the static import graph of each locked
// module (fetch, hash, parse `import`/`export … from`, follow same-origin URLs) so every
// file gets an integrity hash, which becomes an import map `integrity` entry.
import { sri, IntegrityError } from "./strategies.mjs";

// ---------------------------------------------------------------- parsing

const KEYWORDS_BEFORE_REGEX = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);
const WORD = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * The module specifiers a JavaScript source imports statically: `import … from "x"`,
 * `import "x"`, `export … from "x"` (also with `with { … }` attributes). With
 * `dynamic: true`, `import("x")` calls whose argument is a string literal count too.
 * Comments, strings, template literals and regular expressions are skipped, so text
 * that merely looks like an import is not one. A tokenizer, not a full parser: it needs
 * no dependency and handles minified output (`import{a as b}from"/x.mjs"`).
 */
export function parseImports(src, { dynamic = false } = {}) {
  const toks = tokenize(src);
  const out = [];
  const isStr = (t) => t?.t === "s";
  const isP = (t, v) => t?.t === "p" && t.v === v;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== "w" || (t.v !== "import" && t.v !== "export") || isP(toks[k - 1], ".")) continue;
    const next = toks[k + 1];
    if (t.v === "import") {
      if (isStr(next)) out.push(next.v);
      else if (isP(next, "(")) {
        if (dynamic && isStr(toks[k + 2]) && (isP(toks[k + 3], ")") || isP(toks[k + 3], ","))) out.push(toks[k + 2].v);
      } else if (!isP(next, ".")) {
        const s = clauseSource(toks, k + 1);
        if (s !== undefined) out.push(s);
      }
    } else if (isP(next, "*") || isP(next, "{")) {
      const s = clauseSource(toks, k + 1);
      if (s !== undefined) out.push(s);
    }
  }
  return out;
}

// From the first token of an import/export clause, find `from "source"`. Only names,
// commas, braces, `*` and `as` may appear before it; anything else means it isn't one.
function clauseSource(toks, from) {
  for (let j = from; j < toks.length && j < from + 100_000; j++) {
    const t = toks[j];
    if (t.t === "w") {
      if (t.v === "from" && toks[j + 1]?.t === "s") return toks[j + 1].v;
      continue;
    }
    if (t.t === "p" && (t.v === "{" || t.v === "}" || t.v === "," || t.v === "*")) continue;
    return undefined;
  }
  return undefined;
}

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  if (src.startsWith("#!")) while (i < n && src[i] !== "\n") i++;
  const operandBefore = () => {
    const p = toks[toks.length - 1];
    if (!p) return false;
    if (p.t === "w") return !KEYWORDS_BEFORE_REGEX.has(p.v);
    if (p.t === "s" || p.t === "x") return true;
    return p.v === ")" || p.v === "]" || p.v === "}";
  };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿" || c === " " || c === " ") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let v = "";
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { i++; if (i < n) v += src[i]; } else v += src[i];
        i++;
      }
      i++;
      toks.push({ t: "s", v });
      continue;
    }
    if (c === "`") { i = skipTemplate(src, i + 1); toks.push({ t: "x" }); continue; }
    if (c === "/") {
      if (operandBefore()) { toks.push({ t: "p", v: "/" }); i++; continue; }
      i++;
      let inClass = false;
      while (i < n && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      i++;
      while (i < n && WORD.test(src[i])) i++;
      toks.push({ t: "x" });
      continue;
    }
    if (WORD.test(c)) {
      const s = i;
      while (i < n && WORD.test(src[i])) i++;
      toks.push({ t: "w", v: src.slice(s, i) });
      continue;
    }
    toks.push({ t: "p", v: c });
    i++;
  }
  return toks;
}

// index just past the closing backtick of a template literal that starts at `i` (after the opening one)
function skipTemplate(src, i) {
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") { i = skipBraces(src, i + 2); continue; }
    i++;
  }
  return n;
}

// index just past the `}` closing an expression that starts at `i`
function skipBraces(src, i) {
  const n = src.length;
  let depth = 1;
  while (i < n) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) return i + 1; }
    else if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
    } else if (c === "`") { i = skipTemplate(src, i + 1); continue; }
    else if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    else if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    i++;
  }
  return n;
}

// ---------------------------------------------------------------- walking

const NOT_MODULES = /\.(json|css|wasm|map|html?|txt|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Fetch, hash and follow the static import graph from `roots` (module URLs).
 *
 * Breadth-first, shared across roots: each URL is fetched once, `maxFiles` bounds the
 * whole walk and `maxDepth` bounds the hops from a root (the root is depth 0). A file
 * past either bound is not fetched and is reported in `truncated`. Only URLs on a
 * root's origin (or one of `origins`) are followed; bare specifiers are collected in
 * `bare` (they need the import map), other origins and schemes in `skipped`.
 *
 * @returns {Promise<{ files: Map<string,string>, truncated: Array, bare: Set<string>, skipped: Array }>}
 */
export async function walkGraph(roots, {
  fetch, signal, maxFiles = 500, maxDepth = 20, dynamic = false, origins = [], algorithm = "sha384",
  concurrency = 8, expect = () => undefined, report = () => {},
}) {
  const files = new Map();
  const bare = new Set();
  const skipped = [];
  const truncations = new Map(); // `${root}\0${reason}` → { root, reason, limit, skipped }
  const truncate = (root, reason, limit, url) => {
    const k = `${root.url}\0${reason}`;
    const t = truncations.get(k) ?? { root: root.url, reason, limit, skipped: 0, urls: [] };
    t.skipped++;
    if (t.urls.length < 5) t.urls.push(url);
    truncations.set(k, t);
  };
  const seen = new Set();
  let level = [];
  for (const root of roots) {
    const url = new URL(root.url).href;
    if (!seen.has(url)) { seen.add(url); level.push({ url, depth: 0, root }); }
  }
  let fetched = 0;
  while (level.length) {
    const batch = [];
    for (const item of level) {
      if (item.depth > maxDepth) truncate(item.root, "maxDepth", maxDepth, item.url);
      else if (fetched >= maxFiles) truncate(item.root, "maxFiles", maxFiles, item.url);
      else { fetched++; batch.push(item); }
    }
    const children = new Array(batch.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const idx = cursor++;
        children[idx] = await visit(batch[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
    level = [];
    for (const kids of children) for (const kid of kids) if (!seen.has(kid.url)) { seen.add(kid.url); level.push(kid); }
  }

  async function visit({ url, depth, root }) {
    signal?.throwIfAborted();
    let res;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (signal?.aborted || e?.name === "AbortError") throw e;
      throw new IntegrityError(`mport: could not fetch ${url} to hash it (${e?.message ?? e})`, { cause: e });
    }
    if (!res.ok) throw new IntegrityError(`mport: could not fetch ${url} to hash it: it responded ${res.status}`);
    const buf = await res.arrayBuffer();
    const integrity = await sri(buf, algorithm);
    const expected = expect(url);
    if (expected && expected !== integrity) {
      report(root, { type: "fail", phase: "integrity", url, error: `expected ${expected}, got ${integrity}` });
      throw new IntegrityError(`mport: integrity mismatch for ${url}: expected ${expected}, got ${integrity}`);
    }
    files.set(url, integrity);
    const pathname = new URL(url).pathname;
    if (NOT_MODULES.test(pathname)) return [];
    const kids = [];
    const allowed = new Set([new URL(root.url).origin, ...origins]);
    for (const spec of parseImports(new TextDecoder().decode(buf), { dynamic })) {
      let target;
      if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || SCHEME.test(spec)) {
        try { target = new URL(spec, url); } catch { continue; }
      } else { bare.add(spec); continue; }
      if (target.protocol !== "https:" && target.protocol !== "http:") { skipped.push({ url: spec, from: url, reason: `${target.protocol} is not fetched` }); continue; }
      target.hash = "";
      if (!allowed.has(target.origin)) { skipped.push({ url: target.href, from: url, reason: "other origin" }); continue; }
      kids.push({ url: target.href, depth: depth + 1, root });
    }
    return kids;
  }

  const truncated = [...truncations.values()];
  for (const t of truncated) report({ url: t.root }, { type: "truncated", phase: "graph", url: t.root, reason: t.reason, limit: t.limit, skipped: t.skipped, examples: t.urls });
  return { files, truncated, bare, skipped };
}
