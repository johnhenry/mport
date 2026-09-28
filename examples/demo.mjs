// The mport 1.x API, unchanged. In a browser, demo.html shows the results;
// under Deno (`npm run demo`) they are logged.
import mport, { MPort, MPortURL } from "../src/index.mjs";
import { runDemo as run } from "./demo-run.mjs";

export const runDemo = (options = {}) => run({ api: { mport, MPort, MPortURL }, ...options });

if (typeof document === "undefined") await runDemo();
