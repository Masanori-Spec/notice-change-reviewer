"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const analyzer = require("../src/analyzer.js");
const demo = require("../demo/sample-data.js");

// Minimal DOM harness: tests controller behavior, not browser layout/accessibility.
class Node {
  constructor(tag = "div") { this.tagName = tag; this.value = ""; this.textContent = ""; this.children = []; this.hidden = false; this.disabled = false; this.listeners = {}; this.attributes = {}; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
  focus() { this.focused = true; }
  fire(event) { this.listeners[event](); }
}
function app(override = {}) {
  const ids = ["before-text", "after-text", "before-count", "after-count", "results", "result-count", "change-list", "review-notes", "form-error", "analyze-button", "demo-button", "swap-button"];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node()]));
  nodes.results.hidden = nodes["form-error"].hidden = true;
  const document = { getElementById: id => nodes[id], createElement: tag => new Node(tag) };
  const window = { NoticeReviewAnalyzer: { ...analyzer, ...override }, NoticeReviewDemo: demo };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/app.js"), "utf8"), { document, window });
  return nodes;
}
function compare(nodes) { nodes["demo-button"].fire("click"); nodes["analyze-button"].fire("click"); }

test("demo renders five changes and repeated compare replaces old cards", () => {
  const n = app(); compare(n); assert.equal(n.results.hidden, false); assert.equal(n["change-list"].children.length, 5);
  n["analyze-button"].fire("click"); assert.equal(n["change-list"].children.length, 5); assert.equal(n["analyze-button"].disabled, false);
});
test("editing either input removes stale results and error", () => {
  for (const id of ["before-text", "after-text"]) { const n = app(); compare(n); n[id].value += "追記"; n[id].fire("input"); assert.equal(n.results.hidden, true); assert.equal(n["change-list"].children.length, 0); assert.equal(n["form-error"].hidden, true); }
});
test("swap and reloading demo invalidate results", () => {
  const n = app(); compare(n); n["swap-button"].fire("click"); assert.equal(n["before-text"].value, demo.after); assert.equal(n.results.hidden, true);
  n["analyze-button"].fire("click"); n["demo-button"].fire("click"); assert.equal(n.results.hidden, true); assert.equal(n["before-text"].value, demo.before);
});
test("blank input hides old results and gives a recoverable validation error", () => {
  const n = app(); compare(n); n["before-text"].value = " \n"; n["analyze-button"].fire("click"); assert.equal(n.results.hidden, true); assert.equal(n["form-error"].hidden, false);
  compare(n); assert.equal(n["form-error"].hidden, true); assert.equal(n.results.hidden, false);
});
test("oversized input is rejected before analysis", () => {
  let calls = 0; const n = app({ MAX_INPUT_LENGTH: 30000, analyze: () => { calls++; throw Error("Must not execute"); } });
  n["before-text"].value = "あ".repeat(30001); n["after-text"].value = "場所：合成会場"; n["analyze-button"].fire("click");
  assert.equal(calls, 0); assert.equal(n["form-error"].hidden, false); assert.match(n["form-error"].textContent, /30,000/);
});
test("analysis failure clears old cards and reenables button", () => {
  const n = app({ analyze: () => { throw Error("synthetic failure"); } }); compare(n); assert.equal(n.results.hidden, true); assert.equal(n["form-error"].hidden, false); assert.equal(n["analyze-button"].disabled, false);
});
test("markup in user input becomes text nodes, never HTML", () => {
  const n = app(); n["before-text"].value = "場所：合成会場"; n["after-text"].value = '場所：<img src=x onerror="alert(1)">'; n["analyze-button"].fire("click");
  const all = []; const walk = node => { all.push(node); node.children.forEach(walk); }; walk(n["change-list"]);
  assert.ok(all.some(node => node.textContent.includes("<img"))); assert.ok(!all.some(node => node.tagName === "img" || "innerHTML" in node));
});
test("no-change result is explicit and review notes are cleared on next comparison", () => {
  const n = app(); n["before-text"].value = "開催日：年未定"; n["after-text"].value = "開催日：年未定"; n["analyze-button"].fire("click");
  assert.equal(n.results.hidden, false); assert.equal(n["result-count"].textContent, "0 件"); assert.equal(n["review-notes"].hidden, false); assert.match(n["change-list"].children[0].textContent, /検出範囲外/);
  compare(n); assert.equal(n["review-notes"].hidden, true); assert.equal(n["review-notes"].children.length, 0);
});
test("counters track the exact input length including full-width text", () => {
  const n = app(); n["before-text"].value = "合成🙂"; n["before-text"].fire("input"); assert.equal(n["before-count"].textContent, "4 文字");
  n["demo-button"].fire("click"); assert.equal(n["after-count"].textContent, demo.after.length.toLocaleString("ja-JP") + " 文字");
});
test("packaged browser scripts initialize in HTML order without CommonJS", () => {
  const nodes = Object.create(null);
  const document = { getElementById: id => nodes[id] || (nodes[id] = new Node()), createElement: tag => new Node(tag) };
  const context = vm.createContext({ document });
  vm.runInContext("window = globalThis", context);
  for (const file of ["../src/analyzer.js", "../demo/sample-data.js", "../src/app.js"]) vm.runInContext(fs.readFileSync(require.resolve(file), "utf8"), context);
  compare(nodes);
  assert.equal(nodes["result-count"].textContent, "5 件");
  assert.equal(nodes["change-list"].children.length, 5);
});

test("bounded-output rejection has a specific split-input message and no partial cards", () => {
  const n = app(); compare(n);
  n["before-text"].value = "日時:\n".repeat(7500);
  n["analyze-button"].fire("click");
  assert.equal(n.results.hidden,true);
  assert.equal(n["change-list"].children.length,0);
  assert.match(n["form-error"].textContent,/量が上限.*比較を中止/);
  assert.equal(n["analyze-button"].disabled,false);
  compare(n); assert.equal(n["form-error"].hidden,true); assert.equal(n.results.hidden,false);
});
