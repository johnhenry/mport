# MPort

[![npm version](https://img.shields.io/npm/v/mport.svg)](https://www.npmjs.com/package/mport)
[![license](https://img.shields.io/npm/l/mport.svg)](https://opensource.org/licenses/MIT)

MPort is a lightweight ESM utility for dynamically importing modules from npm CDNs such as jsDelivr, JSPM, and Unpkg. It races multiple CDN origins to fetch the fastest available resource and returns both the imported module and the URL used.

## Installation

Unironically, the best way to install MPort in the browser is to use a CDN. You can import it directly in your HTML file:

- https://cdn.jsdelivr.net/npm/mport@1.0.0/index.mjs
- https://ga.jspm.io/npm:mport@1.0.0/index.mjs
- https://unpkg.com/mport@1.0.0/index.mjs

```html
<script type="module">
  import mport from "https://cdn.jsdelivr.net/npm/mport@1.0.0/index.mjs";
  const { default: _ } = await mport("lodash-es@4.17.21");
</script>
```

But it's also available directly as an npm packaged.

```bash
npm install mport
```

## Usage

Use default export, `import` in the same way that you would use dynamic `import()`:

```javascript
import mport from "...";
// Import by specifier string: 'package@version[/path]'
const { default } = await mport("lodash-es@4.17.21");
```

Create custom mport function by defining CDN origins:

```javascript
import { MPort } from "...";
const mport = MPort({
  cdns: ["cdn.jsdelivr.net/npm/", "ga.jspm.io/npm:", "unpkg.com/"],
});
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

With chosen url:

```javascript
import { MPortURL as MPort } from "...";
const mport = MPort();
const [module, url] = await mport("lodash-es@4.17.21");
console.log(url); // The CDN URL that succeeded first
```

### Custom Origins

Pass one or more custom CDN origins to the factory:

```js
const mportCustom = MPort("my.cdn.example.com/", "another.cdn/");
```

For security, we this library prepends the origins with `https://`

## API

### MPort({cdns, useCache, cacheKey='mport-cache'})

- `cdns` (string[]): Optional list of CDN origin prefixes. Defaults to:
  - `'cdn.jsdelivr.net/npm/'`
  - `'ga.jspm.io/npm:'`
  - `'unpkg.com/'`
- `useCache` (string): Name of cache to use. Options:`'localhost'`, undefined
  - `'localhost'`: Use the browser's localStorage to cache the module.
  - `undefined`: Use the browser's cache.
- `cacheKey` (string): Key to use for the cache. Defaults to `'mport-cache'`.
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

## Module Compatibility

MPort is designed for modern Ecmascript modules. It may not work using CommonJS modules.

e.g. Use "lodash-es" instead of "lodash".

## Firefox Compatibility

Currently, this does not work with Firefox.
Adding a second argument to import causes an error: `Uncaught SyntaxError: missing )`

I suspect that this is an issue with SpiderMonkey's static analysis/compilations as it occurs even when not on the executable path.

This makes it particularly difficult to work around, so there is a separate export for Firefox, `mport/firefox` that lacks two features:

    - automatic path resolution -- you must specify the path to the main file within the module

    - ability to pass an options object to the import function

The API is otherwise identical

```javascript
import mport from "mport/firefox";
const module = await mport("lodash-es@4.17.21/src/index.mjs");
```

## TypeScript

This package includes TypeScript declarations. Importing in TS environments will pick up `types.d.ts`.

## Demo

Run the included demo:

```bash
node demo.mjs
```

## License

MIT
