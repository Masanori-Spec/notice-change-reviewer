"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("runtime source has no network, storage, eval, or HTML injection sinks", () => {
  const runtime = ["src/analyzer.js", "src/app.js", "demo/sample-data.js"].map(read).join("\n");
  assert.doesNotMatch(runtime, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|eval)\b|\.cookie\b|\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
});
test("page loads only packaged scripts/styles and has a restrictive policy", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(read("styles.css"), /@import|url\s*\(/i);
  for (const rule of ["connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(html.includes(rule));
  assert.doesNotMatch(html, /\son\w+\s*=/i);
});
test("text demo files match the shipped JavaScript fixture", () => {
  const demo = require("../demo/sample-data.js");
  assert.equal(read("demo/sample_before.txt").trimEnd(), demo.before);
  assert.equal(read("demo/sample_after.txt").trimEnd(), demo.after);
});
