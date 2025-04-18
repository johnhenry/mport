import raceWhich from "./race-which.mjs";
import { DEFAULT_ORIGINS, DEFAULT_CACHE_KEY } from "./config.mjs";

const MPortURL = (
  { cdns = [], cacheKey = DEFAULT_CACHE_KEY, useCache } = {
    cdns: DEFAULT_ORIGINS,
  }
) => {
  const origins = (cdns.length ? cdns : DEFAULT_ORIGINS).map((origin) =>
    typeof origin === "string" ? { path: origin } : origin
  );
  return async (stringOrObject, importOptions) => {
    let name, path, version;
    let cacheName;
    if (typeof stringOrObject === "object") {
      ({ name, version, path } = stringOrObject);
      cacheName = JSON.stringify(stringOrObject);
    } else {
      const [n, ...rest] = stringOrObject.split("@");
      name = n;
      const [v, ...p] = rest.join("/").split("/");
      version = v || "latest";
      path = p.join("/");
      cacheName = stringOrObject;
    }
    if (useCache === "localhost") {
      // check local host for cached url and remove other origins
      const localCache = localStorage.getItem(cacheKey);
      if (localCache) {
        const localCacheParsed = JSON.parse(localCache);
        const localCacheURL = localCacheParsed[cacheName];
        if (localCacheURL) {
          const url = new URL(localCacheURL);
          const origin = origins.find((o) => o.path === url.host);
          if (origin) {
            return [await import(localCacheURL, importOptions), localCacheURL];
          }
        }
      }
    }

    if (path) {
      const urls = origins.map(
        (origin) =>
          `https://${origin.path}${name}${origin.versionMarker ?? "@"}${
            version ?? origin.defaultVersion ?? "latest"
          }/${path}`
      );
      const [result, index] = await raceWhich(
        urls.map((url) => import(url, importOptions))
      );
      if (useCache === "localhost") {
        // cache the url in local storage
        const localCache = localStorage.getItem(cacheKey);
        const localCacheParsed = localCache ? JSON.parse(localCache) : {};
        localCacheParsed[cacheName] = urls[index];
        localStorage.setItem(cacheKey, JSON.stringify(localCacheParsed));
      }
      return [result, urls[index]];
    } else {
      // import package.json and get .main export
      const urls = origins.map(
        (origin) =>
          `https://${origin.path}${name}${origin.versionMarker ?? "@"}${
            version ?? origin.defaultVersion ?? "latest"
          }/package.json`
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
      if (useCache === "localhost") {
        // cache the url in local storage
        const localCache = localStorage.getItem(cacheKey);
        const localCacheParsed = localCache ? JSON.parse(localCache) : {};
        localCacheParsed[cacheName] = mainURL;
        localStorage.setItem(cacheKey, JSON.stringify(localCacheParsed));
      }
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

const mport = MPort();
export { MPort, MPortURL, mport };
export default mport;
