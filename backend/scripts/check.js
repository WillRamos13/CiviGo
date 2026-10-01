const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let failed = false;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (file.endsWith(".js")) {
      const r = spawnSync(process.execPath, ["--check", file], {
        stdio: "inherit",
      });
      if (r.status) failed = true;
    }
  }
}
visit(path.join(__dirname, "../src"));
visit(__dirname);
if (fs.existsSync(path.join(__dirname, "../tests")))
  visit(path.join(__dirname, "../tests"));
if (failed) process.exitCode = 1;
else console.log("Sintaxis de backend, scripts y pruebas válida.");
