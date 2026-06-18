import { existsSync } from "node:fs";

const required = [
  "index.js",
  "server.cjs",
  "dist/index.html",
  "dist/assets",
];

for (const file of required) {
  if (!existsSync(file)) {
    console.error("Missing required file:", file);
    process.exit(1);
  }
}

console.log("Pre-built artifacts OK");
