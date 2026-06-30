# Projektstruktur

```text
holiday-notes/
  index.html                  Einstieg der App
  server.js                   Lokaler Entwicklungsserver
  package.json                Start- und Prüfskripte
  src/
    app.js                    App-Logik, lokale Daten, Supabase-Sync
    styles.css                Layout und Design
  public/
    manifest.webmanifest      PWA-Manifest
    assets/
      app-icon.svg            App-Icon
  config/
    supabase-config.js        Lokale Supabase-Werte, nicht versionieren
    supabase-config.example.js Vorlage für neue Rechner
  supabase/
    schema.sql                Tabellen, Policies und Funktionen
    README.md                 Supabase-Setup
  docs/
    cloud-plan.md             Cloud-Plan
    project-structure.md      Diese Übersicht
  .vscode/
    launch.json               VS-Code-Startkonfiguration
```

## Regeln

- Sichtbare App-Texte und UI-Logik liegen in `src/app.js`.
- Designänderungen liegen in `src/styles.css`.
- PWA-Dateien liegen in `public`.
- Supabase-Datenbankänderungen liegen in `supabase/schema.sql`.
- Lokale Schlüssel und Projektwerte liegen nur in `config/supabase-config.js`.
