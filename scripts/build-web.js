const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const entries = [
  "index.html",
  "offline.html",
  "service-worker.js",
  "src",
  "public",
  "config"
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const entry of entries) {
  const source = path.join(root, entry);
  const target = path.join(dist, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, target, { recursive: true });
}

console.log("Web-App wurde nach dist gebaut.");
