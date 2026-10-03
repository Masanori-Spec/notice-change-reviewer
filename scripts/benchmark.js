"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { analyze, MAX_INPUT_LENGTH } = require("../src/analyzer.js");
const demo = require("../demo/sample-data.js");
const cases = [
  { name: "synthetic demo", before: demo.before, after: demo.after },
  { name: "30000 repeated digits", before: "開催日時：" + "9".repeat(MAX_INPUT_LENGTH - 5), after: "開催日時：2026/10/25 14:00" },
  { name: "30000 whitespace characters", before: "開催日時：" + " ".repeat(MAX_INPUT_LENGTH - 5), after: "開催日時：2026/10/25 14:00" },
  { name: "200 distinct location lines per side", before: Array.from({length: 200}, (_, i) => `場所：合成A${i}`).join("\n"), after: Array.from({length: 200}, (_, i) => `場所：合成B${i}`).join("\n") },
  { name: "30000 empty datetime-label characters (bounded rejection)", before: "日時:\n".repeat(7500), after: "日時:\n".repeat(7500), rejected: true },
  { name: "75 malformed dates per side", before: "開催日：2026/99/99\n".repeat(75).slice(0,MAX_INPUT_LENGTH), after: "開催日：2026/13/99\n".repeat(75).slice(0,MAX_INPUT_LENGTH) }
];
const measurements = cases.map(item => {
  assert.ok(item.before.length <= MAX_INPUT_LENGTH && item.after.length <= MAX_INPUT_LENGTH);
  const run = () => {
    try {
      const result = analyze(item.before, item.after);
      assert.ok(!item.rejected, "Expected bounded rejection");
      return result;
    } catch (error) {
      if (!item.rejected || error.code !== "OUTPUT_LIMIT") throw error;
      return {changes:[],notes:[],rejected:true};
    }
  };
  run(); // warm-up is not part of the measurements
  const timings = [];
  let result;
  for (let i = 0; i < 7; i++) { const start = performance.now(); result = run(); timings.push(performance.now() - start); }
  timings.sort((a,b) => a-b);
  return { name: item.name, beforeLength: item.before.length, afterLength: item.after.length, rejected: !!result.rejected, changes: result.changes.length, notes: result.notes.length, medianMs: +timings[3].toFixed(3), maxMs: +timings[6].toFixed(3) };
});
const report = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model || "unavailable", repeats: 7, warmups: 1, measurements, limitation: "Synthetic Node.js extraction timings only; excludes DOM rendering and does not prove latency on user devices or all possible inputs." };
fs.mkdirSync(path.join(__dirname,"../artifacts"),{recursive:true});
fs.writeFileSync(path.join(__dirname,"../artifacts/benchmark-results.json"), JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
