// A small semver implementation: enough to pick an exact version from registry
// metadata for the range syntax people actually write in import specifiers.
// Supports exact, x-ranges (1, 1.2, 1.x, *), ^, ~, comparators (>=, <, …),
// hyphen ranges (1.2.3 - 2) and unions (||). Prereleases only match when the
// range itself names a prerelease on the same major.minor.patch.

const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parse(v) {
  const m = RE.exec(String(v).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}

export const valid = (v) => parse(v) !== null;

export function compare(a, b) {
  const x = typeof a === "string" ? parse(a) : a;
  const y = typeof b === "string" ? parse(b) : b;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length ? -1 : y.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// "1" → {major:1}, "1.2" → {major:1,minor:2}, "x"/"*" → {}
function partial(s) {
  // the prerelease may itself contain "-" ("1.0.0-beta-2.1"): split on the first one only
  const bare = s.replace(/^v/, "").replace(/\+.*$/, "");
  const dash = bare.indexOf("-");
  const [core, pre] = dash === -1 ? [bare] : [bare.slice(0, dash), bare.slice(dash + 1)];
  const parts = core.split(".");
  const out = {};
  const keys = ["major", "minor", "patch"];
  for (let i = 0; i < 3; i++) {
    const p = parts[i];
    if (p === undefined || p === "" || /^[xX*]$/.test(p)) break;
    if (!/^\d+$/.test(p)) return null;
    out[keys[i]] = +p;
  }
  if (pre && out.patch !== undefined) out.pre = pre.split(".");
  return out;
}

const v = (major, minor = 0, patch = 0, pre = []) => ({ major, minor, patch, pre });

// Expand one comparator token into [op, version] pairs.
function comparators(token) {
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const op = m[1] || "";
  const p = partial(m[2] || "*");
  if (!p) throw new TypeError(`mport: invalid version range "${token}"`);
  const { major, minor, patch, pre = [] } = p;
  if (major === undefined) return op === "<" || op === ">" ? [["<", v(0)]] : [];
  const full = patch !== undefined;
  switch (op) {
    case "^": {
      const lo = v(major, minor ?? 0, patch ?? 0, pre);
      const hi =
        major > 0 || minor === undefined ? v(major + 1)
        : minor > 0 || patch === undefined ? v(0, minor + 1)
        : v(0, 0, patch + 1);
      return [[">=", lo], ["<", hi]];
    }
    case "~": {
      const lo = v(major, minor ?? 0, patch ?? 0, pre);
      const hi = minor === undefined ? v(major + 1) : v(major, minor + 1);
      return [[">=", lo], ["<", hi]];
    }
    case ">": return full ? [[">", v(major, minor, patch, pre)]]
      : [[">=", minor === undefined ? v(major + 1) : v(major, minor + 1)]];
    case "<=": return full ? [["<=", v(major, minor, patch, pre)]]
      : [["<", minor === undefined ? v(major + 1) : v(major, minor + 1)]];
    case ">=": case "<": return [[op, v(major, minor ?? 0, patch ?? 0, pre)]];
    default:
      if (full) return [["=", v(major, minor, patch, pre)]];
      return [[">=", v(major, minor ?? 0)], ["<", minor === undefined ? v(major + 1) : v(major, minor + 1)]];
  }
}

function parseRange(range) {
  return String(range).split("||").map((alt) => {
    alt = alt.trim();
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt);
    if (hyphen) {
      const lo = comparators(`>=${hyphen[1]}`);
      const hiP = partial(hyphen[2]);
      const hi = hiP.patch !== undefined ? [["<=", v(hiP.major, hiP.minor, hiP.patch, hiP.pre)]] : comparators(`<=${hyphen[2]}`);
      return [...lo, ...hi];
    }
    return alt.replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").split(/\s+/).filter(Boolean).flatMap(comparators);
  });
}

const test = (ver, [op, c]) => {
  const r = compare(ver, c);
  return op === "=" ? r === 0 : op === ">" ? r > 0 : op === ">=" ? r >= 0 : op === "<" ? r < 0 : r <= 0;
};

export function satisfies(version, range) {
  const ver = parse(version);
  if (!ver) return false;
  return parseRange(range).some((set) => {
    if (!set.every((c) => test(ver, c))) return false;
    if (!ver.pre.length) return true;
    // prereleases only match a comparator that names a prerelease on the same tuple
    return set.some(([, c]) => c.pre.length && c.major === ver.major && c.minor === ver.minor && c.patch === ver.patch);
  });
}

export function maxSatisfying(versions, range) {
  let best = null;
  for (const ver of versions) {
    if (satisfies(ver, range) && (!best || compare(ver, best) > 0)) best = ver;
  }
  return best;
}
