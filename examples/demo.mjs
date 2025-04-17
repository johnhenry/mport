import MPort, { MPortURL } from "../src/index.mjs";

const name = `lodash-es`;
const version = `4.17.21`;
const path = `lodash.js`;

{
  const mport = MPort();
  const { default: _ } = await mport(`${name}@${version}/${path}`);
  console.log(_.partition([1, 2, 3, 4], (n) => n % 2));
}
{
  const mport = MPortURL();
  const [{ default: _ }, url] = await mport({ name, version, path });
  console.log("URL:", url);
  console.log(_.partition([1, 2, 3, 4], (n) => n % 2));
}
