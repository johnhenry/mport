import raceWhich from "./race-which.mjs";
import { DEFAULT_ORIGINS } from "./config.mjs";

const MPortURL = (...inputs) => {
  const origins = inputs.length ? inputs : DEFAULT_ORIGINS;
  return async (stringOrObject) => {
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
    const urls = origins.map(
      (origin) => `https://${origin}${name}@${version}/${path}`
    );
    const [result, index] = await raceWhich(urls.map((url) => import(url)));
    return [result, urls[index]];
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
