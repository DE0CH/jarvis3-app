// The iOS app runs on Hermes, which lacks some newer Array methods (`toSorted` crashed the new
// chat screen in the simulator with "undefined is not a function"). The web build has them, so
// only the simulator test would notice; this keeps them out of the variant's code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MISSING_ON_HERMES = [
  ".toSorted(",
  ".toReversed(",
  ".toSpliced(",
  ".findLast(",
  ".findLastIndex(",
  ".at(-",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function offenders(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return MISSING_ON_HERMES.filter((m) => text.includes(m)).map(
    (m) => `${path.basename(file)}: ${m}`,
  );
}

describe("jarvis3 code runs on Hermes", () => {
  it("uses none of the Array methods Hermes lacks", () => {
    expect(sources(__dirname).flatMap(offenders)).toEqual([]);
  });
});
