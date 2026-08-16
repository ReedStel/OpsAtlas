import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
await access(workerUrl);
workerUrl.searchParams.set("validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
assert.equal(typeof worker.default?.fetch, "function", "Expected an ESM Worker default.fetch export");
process.stdout.write("Validated production worker entry point.\n");
