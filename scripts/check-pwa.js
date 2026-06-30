const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "public", "manifest.webmanifest");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const requiredIcons = [
  ["public/assets/app-icon-192.png", "192x192"],
  ["public/assets/app-icon-512.png", "512x512"],
  ["public/assets/apple-touch-icon.png", "180x180"]
];

for (const [relativePath] of requiredIcons) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) {
    throw new Error(`PWA-Datei fehlt oder ist leer: ${relativePath}`);
  }
}

if (manifest.display !== "standalone") throw new Error("Manifest muss display=standalone verwenden.");
if (!manifest.start_url || !manifest.scope) throw new Error("Manifest benötigt start_url und scope.");

for (const [relativePath, size] of requiredIcons.slice(0, 2)) {
  const icon = manifest.icons?.find((entry) => entry.sizes === size);
  if (!icon || !relativePath.endsWith(icon.src.replace("./", "public/"))) {
    throw new Error(`Manifest-Icon ${size} fehlt.`);
  }
}

console.log("PWA-Prüfung erfolgreich.");
