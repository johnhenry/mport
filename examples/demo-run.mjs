// The demo calls, shared by demo.mjs and demo.firefox.mjs. It imports nothing from
// mport itself, so the Firefox demo never loads the standard entry point.
export async function runDemo({ api, report = (label, value) => console.log(label, value) }) {
  const name = "lodash-es";
  const version = "4.17.21";
  const path = "lodash.js";
  const odd = (n) => n % 2;

  {
    const { default: _ } = await api.mport(`${name}@${version}/${path}`);
    report(`mport("${name}@${version}/${path}")`, `_.partition([1, 2, 3, 4], odd) → ${JSON.stringify(_.partition([1, 2, 3, 4], odd))}`);
  }
  {
    const custom = api.MPort({ cdns: ["cdn.jsdelivr.net/npm/", "unpkg.com/"] });
    const { default: _ } = await custom(`${name}@${version}/${path}`);
    report(`MPort({ cdns: [jsDelivr, unpkg] })(…)`, `_.chunk([1, 2, 3, 4], 2) → ${JSON.stringify(_.chunk([1, 2, 3, 4], 2))}`);
  }
  {
    const [{ default: _ }, url, info] = await api.MPortURL()({ name, version, path });
    report(`MPortURL()({ name, version, path })`, `winner: ${url}\nvia ${info.provider ?? "—"}; ${info.trace?.length ?? 0} trace events\n_.sum([1, 2, 3]) → ${_.sum([1, 2, 3])}`);
  }
  {
    const [, url, info] = await api.MPortURL()(name + "@" + version);
    report(`MPortURL()("${name}@${version}")  // no path`, `package.json → entry ${info.entry}\n${url}`);
  }
}

