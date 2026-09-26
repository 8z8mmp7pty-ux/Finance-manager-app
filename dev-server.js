// Local development server: serves the static files and the /api functions.
// Usage: DATABASE_URL=... npm run dev
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import entries from "./api/entries.js";
import budgets from "./api/budgets.js";
import plans from "./api/plans.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const publicFiles = new Set(["/index.html", "/style.css", "/app.js", "/ledger.js"]);

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/entries") return entries(req, res);
    if (pathname === "/api/budgets") return budgets(req, res);
    if (pathname === "/api/plans") return plans(req, res);

    const file = pathname === "/" ? "/index.html" : pathname;
    if (!publicFiles.has(file)) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    res.setHeader("Content-Type", types[path.extname(file)]);
    res.end(await readFile(path.join(root, "public", file)));
  })
  .listen(process.env.PORT || 3000, () => {
    console.log(`Finance Manager running at http://localhost:${process.env.PORT || 3000}`);
  });
