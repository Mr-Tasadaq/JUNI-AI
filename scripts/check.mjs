import { readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const ignored = new Set(["node_modules", ".git"]);
const files = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (extname(entry.name) === ".js") {
      files.push(path);
    }
  }
}

await walk(root.pathname);
files.sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(".");
}
process.stdout.write("\nChecked " + files.length + " JavaScript files.\n");
void relative;
