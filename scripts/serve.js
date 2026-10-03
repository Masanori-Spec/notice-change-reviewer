"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.join(__dirname, "..");
// Development/CI only: the server exposes exactly the packaged runtime assets.
const assets = new Map([
  ["/index.html", "text/html; charset=utf-8"],
  ["/styles.css", "text/css; charset=utf-8"],
  ["/src/analyzer.js", "text/javascript; charset=utf-8"],
  ["/src/app.js", "text/javascript; charset=utf-8"],
  ["/demo/sample-data.js", "text/javascript; charset=utf-8"]
]);
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!assets.has(name) || !["GET", "HEAD"].includes(req.method)) {
        res.writeHead(404); res.end("Not found"); return;
      }
      const bytes = await fs.readFile(path.join(root, name));
      // The real page's meta CSP is the tested policy, not a second CI-only CSP.
      res.writeHead(200, {
        "Content-Type": assets.get(name), "Content-Length": bytes.length,
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 4193);
  createServer().listen(port, "127.0.0.1", () => console.log(`Notice Change Reviewer: http://127.0.0.1:${port}`));
}
