"use strict";
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
for (const dir of ["src", "demo", "scripts", "tests"]) {
  for (const file of readdirSync(path.join(__dirname, "..", dir))) {
    if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", path.join(dir, file)], { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  }
}
console.log("All JavaScript syntax checks passed");
