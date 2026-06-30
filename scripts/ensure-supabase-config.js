const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const configDir = path.join(root, "config");
const configPath = path.join(configDir, "supabase-config.js");

if (fs.existsSync(configPath)) {
  process.exit(0);
}

const url = process.env.SUPABASE_URL || process.env.HOLIDAY_NOTES_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.HOLIDAY_NOTES_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    [
      "Supabase-Konfiguration fehlt.",
      "Lege config/supabase-config.js lokal an oder setze beim Hosting SUPABASE_URL und SUPABASE_ANON_KEY."
    ].join(" ")
  );
}

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  configPath,
  [
    "window.HOLIDAY_NOTES_SUPABASE = {",
    `  url: ${JSON.stringify(url)},`,
    `  anonKey: ${JSON.stringify(anonKey)}`,
    "};",
    ""
  ].join("\n"),
  "utf8"
);

console.log("Supabase-Konfiguration wurde aus Umgebungsvariablen erstellt.");
