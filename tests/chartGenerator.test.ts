import { test, expect } from "bun:test";
import { spawnSync } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The generator is C++ compiled to wasm for the browser. The rules it enforces
// are checked natively so a chart can be inspected without a browser at all.
const repositoryRoot = join(import.meta.dir, "..");
const harnessSource = join(repositoryRoot, "tests", "chartGeneratorHarness.cpp");
const harnessBinary = join(tmpdir(), "chartGeneratorHarness");

function run(command: string[]) {
  return spawnSync(command, { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
}

test("chart generator honours every difficulty rule", () => {
  const build = run([
    "g++",
    "-std=c++17",
    "-O2",
    "-o",
    harnessBinary,
    harnessSource,
  ]);
  expect(build.stderr.toString()).toBe("");
  expect(build.exitCode).toBe(0);

  const result = run([harnessBinary, join(repositoryRoot, "patterns.json")]);
  const output = result.stdout.toString();

  console.log(output);
  expect(output).toContain("all checks passed");
  expect(result.exitCode).toBe(0);
});
