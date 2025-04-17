# MPort

[![npm version](https://img.shields.io/npm/v/mport.svg)](https://www.npmjs.com/package/mport)
[![license](https://img.shields.io/npm/l/mport.svg)](https://opensource.org/licenses/MIT)

MPort is a lightweight ESM utility for dynamically importing modules from npm CDNs such as jsDelivr, JSPM, and Unpkg. It races multiple CDN origins to fetch the fastest available resource and returns both the imported module and the URL used.

## Installation

```bash
npm install mport
```

### Browser

Unironically, the best way to install MPort in the browser is to use a CDN. You can import it directly in your HTML file:

- https://cdn.jsdelivr.net/npm/mport@0.0.1/src/index.mjs
- https://ga.jspm.io/npm:mport@0.0.1/src/index.mjs
- https://unpkg.com/mport@0.0.1/src/index.mjs

```html
<script type="module">
  import { MPort } from "https://cdn.jsdelivr.net/npm/mport@0.0.1/src/index.mjs";
  const mport = MPort();
  const { default: _ } = await mport("lodash-es@4.17.21");
</script>
```

## Usage

```js
import MPort from "mport";

const mport = MPort();
// Import by specifier string: 'package@version[/path]'
const module = await mport("lodash-es@4.17.21");
console.log(module); // The imported module namespace

// Import with options object
const module = await mport({
  name: "spintax",
  version: "1.1.2",
  path: "src/index.mjs",
});
```

with url:

```js
import { MPortURL as MPort } from "mport";
const mport = MPort();
const [module, url] = await mport("lodash-es@4.17.21");
console.log(url); // The CDN URL that succeeded first
console.log(module); // The imported module namespace
```

### Custom Origins

Pass one or more custom CDN origins to the factory:

```js
const mportCustom = MPort(
  "https://my.cdn.example.com/",
  "https://another.cdn/"
);
```

## API

### MPort(...origins)

- `origins` (string[]): Optional list of CDN origin prefixes. Defaults to:
  - `cdn.jsdelivr.net/npm/`
  - `ga.jspm.io/npm:`
  - `unpkg.com/`
- Returns: A function `(input) => Promise<module>`.

#### Input

- `input` can be:
  - A specifier string: `'name@version[/path]'`.
  - An options object:
    - `name` (string): Package name.
    - `version` (string, optional): Package version or tag (default `'latest'`).
    - `path` (string, optional): Sub-path inside the package.

#### Return Value

A `Promise` that resolves to a `module` (any): The imported ES module namespace.

### MPortURL(...origins)

MPortURL functions similarly to MPort, but returns a tuple of the imported module and the URL used: A function `(input) => Promise<[module, url]>`.

## Caching

MPort does not handle caching and relies on the runtime's underlying caching mechanisms.

## Compatibility

MPort is designed for modern Ecmascript modules. It may not work using CommonJS modules.

e.g. Use "lodash-es" instead of "lodash".

## TypeScript

This package includes TypeScript declarations. Importing in TS environments will pick up `types.d.ts`.

## Demo

Run the included demo:

```bash
node demo.mjs
```

## License

MIT
