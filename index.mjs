//
const raceWhich = async (queue) => {
  let [completed] = await Promise.race(queue.map((p) => p.then((res) => [p])));
  const index = queue.findIndex((p) => p === completed);
  return [await completed, index];
};

const DEFAULT_ORIGINS = [
  "cdn.jsdelivr.net/npm/",
  "ga.jspm.io/npm:",
  "unpkg.com/",
];

const MPortURL = (...inputs) => {
  const origins = inputs.length ? inputs : DEFAULT_ORIGINS;
  return async (stringOrObject, importOptions) => {
    let name, path, version;
    if (typeof stringOrObject === "object") {
      ({ name, version = "latest", path } = stringOrObject);
    } else {
      const [n, ...rest] = stringOrObject.split("@");
      name = n;
      const [v, ...p] = rest.join("/").split("/");
      version = v || "latest";
      path = p.join("/");
    }
    if (path) {
      const urls = origins.map(
        (origin) => `https://${origin}${name}@${version}/${path}`
      );
      const [result, index] = await raceWhich(
        urls.map((url) => import(url, importOptions))
      );
      return [result, urls[index]];
    } else {
      // import package.json and get .main export
      const urls = origins.map(
        (origin) => `https://${origin}${name}@${version}/package.json`
      );
      const [result, index] = await raceWhich(
        urls.map((url) => import(url, { with: { type: "json" } }))
      );
      const {
        default: { main },
      } = result;
      const targetURL = urls[index];
      const lastIndexOfPackageJson = targetURL.lastIndexOf("/package.json");
      const urlWithoutPackageJson = targetURL.slice(0, lastIndexOfPackageJson);
      const mainPath = main.startsWith("./") ? main.slice(2) : main;
      const mainURL = `${urlWithoutPackageJson}/${mainPath}`;
      const mainResult = await import(mainURL, importOptions);
      return [await mainResult, mainURL];
    }
  };
};

// Like MPort, but returns the raw import result without the URL
const MPort = (...inputs) => {
  const mport = MPortURL(...inputs);
  return async (...args) => {
    const [result] = await mport(...args);
    return result;
  };
};

export { MPort, MPortURL };

export default MPort;
