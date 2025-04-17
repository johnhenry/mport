import MPort from "./index.mjs";
const mport = MPort();
// const [spintax, path] = await mport({
//   name: "spintax",
//   // path: "src/index.mjs",
//   version: "1.1.2",
// });
const [spintax, path] = await mport("spintax@1.1.2");
console.log(path);
console.log(spintax);
