# Holiday Notes

Mobile Packlisten-, Einkaufslisten- und Reiseplanungs-App mit Anmeldung, Cloud-Synchronisierung und gemeinsamer Reisenutzung.

## Lokal starten

```powershell
npm.cmd install
npm.cmd run dev
```

Danach `http://localhost:5175` öffnen. Ein anderer Port kann über die Umgebungsvariable `PORT` gesetzt werden.

## Funktionen

- mehrere Reisen und gemeinsame Mitreisende
- Packliste mit Kategorien, Personen und Einkaufseinträgen
- Einkaufsliste mit Filtern
- Gerichte, Snacks und Zutaten
- Anmeldung, Profil, E-Mail und Passwort
- automatische lokale Speicherung und Supabase-Synchronisierung
- Dark Mode und mobile Navigation
- installierbare Progressive Web App
- dauerhafte Kontolöschung

## Supabase einrichten

1. `supabase/schema.sql` vollständig im Supabase SQL Editor ausführen.
2. E-Mail-Anmeldung unter Authentication aktivieren.
3. Die produktive URL unter Authentication > URL Configuration eintragen.
4. `config/supabase-config.example.js` als `config/supabase-config.js` kopieren und Project URL sowie anon key eintragen.
5. Niemals den `service_role`-Key in die Web-App einbauen.

Das Schema enthält Tabellen, RLS-Regeln, Freundeverknüpfungen, Realtime und die abgesicherte Funktion zur Kontolöschung.

## Als Handy-App

Die App wird zuerst als PWA veröffentlicht. Das ist für den aktuellen Stand der schnellste und flexibelste Weg:

- Android: Chrome öffnen und die App installieren.
- iPhone: Safari > Teilen > Zum Home-Bildschirm.
- Updates: Code ändern, `npm.cmd run release:web` ausführen und `dist` neu veröffentlichen.

Für Google Play oder Apple App Store kann die Web-App später mit Capacitor verpackt werden. Die verbleibenden Schritte stehen in `docs/app-release-checklist.md`.

## Veröffentlichung

```powershell
npm.cmd run release:web
```

Der fertige Web-Build liegt danach in `dist`. Hosting-Hinweise stehen in `docs/pwa-veroeffentlichung.md`.

## Wichtige Dateien

- `src/app.js`: App-Logik
- `src/styles.css`: Oberfläche und Responsive Design
- `public/manifest.webmanifest`: PWA-Konfiguration
- `service-worker.js`: Offline-App-Shell
- `supabase/schema.sql`: Cloud-Schema und Berechtigungen
- `docs/app-release-checklist.md`: Veröffentlichung
