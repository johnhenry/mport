// The mport 1.x API, unchanged, against the real CDNs. compat.html runs the same
// kind of calls in a browser; under Deno (`npm run demo`) the results are logged.
import mport, { MPort, MPortURL } from "../src/index.mjs";
import { runDemo as run } from "./demo-run.mjs";

export const runDemo = (options = {}) => run({ api: { mport, MPort, MPortURL }, ...options });

if (typeof document === "undefined") await runDemo();
