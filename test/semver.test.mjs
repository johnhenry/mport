import { test } from "node:test";
import assert from "node:assert/strict";
import { satisfies, maxSatisfying, compare } from "../src/semver.mjs";

test("compare orders prereleases before releases", () => {
  assert.equal(compare("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compare("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compare("2.0.0", "1.9.9"), 1);
});

test("ranges", () => {
  const cases = [
    ["^19", "19.2.0", true], ["^19", "20.0.0", false], ["^0.2.3", "0.2.9", true], ["^0.2.3", "0.3.0", false],
    ["^0.0.3", "0.0.4", false], ["~1.2.3", "1.2.9", true], ["~1.2.3", "1.3.0", false], ["1", "1.9.0", true],
    ["1.2", "1.3.0", false], ["1.x", "1.4.0", true], ["*", "3.0.0", true], [">=1.2 <2", "1.5.0", true],
    [">= 1.2 < 2", "2.0.0", false], ["1.2.3 - 2", "2.9.0", true], ["1.2.3 - 2.1.0", "2.1.1", false],
    ["^1 || ^3", "3.1.0", true], ["=1.0.0", "1.0.0", true], ["^20", "20.0.0-rc.1", false],
    [">=20.0.0-rc.0", "20.0.0-rc.1", true],
  ];
  for (const [range, v, want] of cases) assert.equal(satisfies(v, range), want, `${v} ${range}`);
});

test("maxSatisfying", () => {
  assert.equal(maxSatisfying(["18.3.1", "19.0.0", "19.2.0", "20.0.0-rc.1"], "^19"), "19.2.0");
  assert.equal(maxSatisfying(["1.0.0"], "^2"), null);
});
