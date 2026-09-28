// The same 1.x demo against the Firefox entry point (no two-argument import()).
import mport, { MPort, MPortURL } from "../src/firefox.mjs";
import { runDemo } from "./demo-run.mjs";

export const runFirefoxDemo = (report) => runDemo({ api: { mport, MPort, MPortURL }, report });

if (typeof document === "undefined") await runFirefoxDemo();
