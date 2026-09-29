// Shared UI for the mport examples: page header, the resolution timeline,
// plain-English verdicts, result cards and the health table.

export const PAGES = [
  ["playground.html", "Playground", "learn how routing behaves"],
  ["app.html", "App", "use mport in a real page"],
  ["compat.html", "Compatibility", "the 1.x API, checked"],
];

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};

export const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); }, { once: true });
});

/** The common header: brand + the three pages as tabs. */
export function header(active) {
  const nav = h("nav", { className: "pages" },
    h("b", { className: "brand" }, "mport"),
    PAGES.map(([href, label, hint]) => h("a", { href, title: hint, "aria-current": href === active ? "page" : "false" }, label)),
    h("a", { className: "gh", href: "https://github.com/johnhenry/mport" }, "GitHub"));
  let el = document.querySelector("header.top");
  if (!el) document.body.prepend((el = h("header", { className: "top" })));
  el.replaceChildren(nav);
}

/** Colour key for the timeline. */
export const legend = () => h("div", { className: "legend" },
  h("span", {}, h("i", { style: { background: "var(--accent)" } }), "registry lookup (range → exact version)"),
  h("span", {}, h("i", { style: { background: "var(--ok)" } }), "CDN answered"),
  h("span", {}, h("i", { style: { background: "var(--fail)" } }), "CDN failed"),
  h("span", {}, h("i", { style: { background: "var(--skip)", opacity: ".6" } }), "cancelled / lost the race"),
  h("span", {}, h("i", { style: { background: "repeating-linear-gradient(45deg,var(--skip) 0 3px,transparent 3px 6px)" } }), "skipped without asking (reason shown)"));

/** Rows for router.health.snapshot(). */
export function healthRows(snapshot) {
  const rows = Object.entries(snapshot);
  const now = performance.now();
  return rows.length ? rows.map(([name, s]) =>
    h("tr", {}, h("td", {}, name), h("td", {}, s.ok), h("td", {}, s.fail),
      h("td", {}, s.latency != null ? `${Math.round(s.latency)} ms` : "—"),
      h("td", { className: s.healthy ? "closed" : "open" }, s.healthy ? "closed" : `open · ${Math.ceil((s.openUntil - now) / 1000)}s`)))
    : [h("tr", {}, h("td", { colSpan: 5, className: "hint" }, "No requests yet."))];
}

export const healthTable = (tbodyId = "health") => h("table", {},
  h("thead", {}, h("tr", {}, ["provider", "ok", "fail", "latency", "circuit"].map((c) => h("th", {}, c)))),
  h("tbody", { id: tbodyId }, healthRows({})));

export function timeline(trace, t0) {
  const lanes = new Map();
  const lane = (p) => lanes.get(p) ?? lanes.set(p, { bars: [], skips: [] }).get(p);
  const open = new Map();
  for (const e of trace) {
    if (e.type === "probe" || e.type === "lookup") open.set(`${e.provider} ${e.url}`, e);
    else if (e.type === "skip") lane(e.provider).skips.push(e.reason);
    else if (e.cached) lane(e.provider).bars.push({ type: "ok", start: e.at - t0, end: e.at - t0, label: "cache hit" });
    else {
      const start = open.get(`${e.provider} ${e.url}`);
      open.delete(`${e.provider} ${e.url}`);
      const label = e.type === "resolved" ? `→ ${e.version} ${Math.round(e.ms ?? 0)}ms`
        : e.type === "selected" ? "selected (probe: none)"
        : e.reason ? `${e.type}: ${e.reason}` : `${e.type} ${Math.round(e.ms ?? 0)}ms`;
      lane(e.provider).bars.push({ type: e.type, start: (start?.at ?? e.at) - t0, end: e.at - t0, label });
    }
  }
  for (const [, e] of open) lane(e.provider).bars.push({ type: "pending", start: e.at - t0, end: performance.now() - t0, label: "…" });
  const max = Math.max(50, ...[...lanes.values()].flatMap((l) => l.bars.map((b) => b.end)));
  return h("div", {},
    h("div", { className: "timeline" }, [...lanes].map(([who, l]) =>
      h("div", { className: "lane" },
        h("div", { className: "who", title: who }, who),
        h("div", { className: "track" },
          l.bars.length === 0 && l.skips.length ? h("div", { className: "bar skip", title: l.skips.join("; ") }) : null,
          // only a lane's last bar gets a text label (earlier ones keep theirs in a tooltip), so labels never overlap
          l.bars.map((b, i) => h("div", { className: `bar ${b.type}`, title: l.bars.map((x) => x.label).join(" → "),
            style: { left: `${(b.start / max) * 80}%`, width: `${Math.max(0.5, ((b.end - b.start) / max) * 80)}%` } },
            i === l.bars.length - 1 ? h("span", {}, l.bars.length > 1 ? l.bars.map((x) => x.label.split(" ")[0]).join(" → ") + (b.label.includes("ms") ? ` ${b.label.split(" ").at(-1)}` : "") : b.label) : null)),
          l.skips.length && l.bars.length === 0 ? h("span", { className: "skipreason", title: l.skips.join("\n") }, `skipped: ${l.skips[0]}`) : null,
        )))),
    h("div", { className: "axis" }, h("span", {}, "0 ms"), h("span", {}, `${Math.round(max)} ms`)));
}

// One plain-English sentence per result, derived from the trace.
export const short = (text = "") => text.replace(/^[^:]+: /, "").replace(/ \(use an ESM.*$/, "").replace(/^mport: /, "");
export function verdict(spec, r, err) {
  const trace = r?.trace ?? err?.trace ?? [];
  const by = (type) => [...new Set(trace.filter((e) => e.type === type).map((e) => e.provider))].filter((p) => !/registry$/.test(p));
  const skipped = trace.filter((e) => e.type === "skip");
  const phased = (phase) => [...new Set(trace.filter((e) => e.type === "fail" && e.phase === phase).map((e) => e.provider))];
  const tampered = phased("integrity");
  const importFailed = phased("import");
  const failed = by("fail").filter((p) => trace.some((e) => e.type === "fail" && e.provider === p && !e.phase));
  const lost = trace.filter((e) => e.type === "aborted").map((e) => e.provider);
  const why = (p) => short(skipped.find((e) => e.provider === p)?.reason);
  const parts = [];
  if (err) {
    if (err.name === "ResolutionError") {
      const cause = /may not exist|not found/.test(err.message) ? "the package may not exist, or the registry is unreachable" : /satisfies/.test(err.message) ? "no published version matches that range" : "the registry lookup failed";
      return { good: false, text: `✗ Couldn't turn "${spec}" into an exact version: ${cause}. No CDN was asked.` };
    }
    const cjs = skipped.filter((e) => /CommonJS/.test(e.reason ?? ""));
    if (cjs.length && cjs.length + failed.length >= (err.errors?.length ?? 0)) {
      return { good: false, text: `✗ No CDN left can serve it. ${failed.length ? `${failed.join(", ")} failed; ` : ""}${cjs.map((e) => e.provider).join(" and ")} only serve raw files, and this package ships CommonJS, which browsers can't import.` };
    }
    return { good: false, text: `✗ Every CDN was ruled out: ${[...failed.map((p) => `${p} failed`), ...skipped.map((e) => `${e.provider} skipped (${short(e.reason)})`)].join("; ")}.` };
  }
  if (!r) return { good: false, text: "No route matched, so mport leaves this specifier to the browser." };
  const pinned = !trace.some((e) => e.type === "lookup") && r.range && !/^\d+\.\d+\.\d+/.test(r.range);
  if (pinned) parts.push(`version ${r.version} came from the lockfile, with no registry lookup`);
  for (const e of skipped) if (!(e.reason === "excluded" && importFailed.includes(e.provider))) parts.push(`${e.provider} skipped (${why(e.provider)})`);
  if (failed.length) parts.push(`${failed.join(", ")} failed`);
  if (tampered.length) parts.push(`${tampered.join(", ")} rejected: its bytes didn't match the lockfile's hash`);
  if (importFailed.length) parts.push(`${importFailed.join(", ")} passed the check but its import failed, so it was excluded and the next CDN used`);
  if (lost.length) parts.push(`beat ${[...new Set(lost)].join(", ")} in a race`);
  if (r.integrity) parts.push(`bytes verified (${r.integrity.slice(0, 14)}…)`);
  const how = trace.some((e) => e.type === "selected") ? "picked (not checked, probe: none)" : "served";
  return { good: true, text: `✓ ${how} by ${r.provider}${parts.length ? ": " + parts.join("; ") : ""}.` };
}

export function card(spec, r, err, t0) {
  const trace = r?.trace ?? err?.trace ?? [];
  const v = verdict(spec, r, err);
  const meta = r
    ? `${r.version ? `v${r.version} · ` : ""}${r.provider}${r.build ? ` (${r.build})` : ""}${r.cached ? " · cached" : ""}${r.integrity ? ` · ${r.integrity.slice(0, 22)}…` : ""}`
    : null;
  return h("div", { className: "card" },
    h("h3", {}, spec),
    h("div", { className: `verdict ${v.good ? "good" : "bad"}` }, v.text),
    r ? h("div", { className: "meta" }, meta, h("br"), h("a", { href: r.base ?? r.url, target: "_blank", rel: "noopener" }, r.base ?? r.url)) : null,
    r === null ? h("div", { className: "meta" }, "no route matched — left to the browser") : null,
    err ? h("div", { className: "error" }, `${err.name}: ${err.message}${err.errors ? "\n" + err.errors.map((e) => `  · ${e.message}`).join("\n") : ""}`) : null,
    trace.length ? timeline(trace, t0) : null);
}

