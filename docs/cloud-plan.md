# Cloud-Plan

Ziel: Mehrere Personen sollen kostenlos oder möglichst lange kostenlos gemeinsam an einer Packliste arbeiten.

## Empfehlung für den Start

Ich würde Supabase Free Tier verwenden.

Gründe:

- kostenlose Authentifizierung per E-Mail
- kostenlose Postgres-Datenbank für kleine Projekte
- Realtime-Abos für gemeinsame Listen
- später leicht auf eigene API oder bezahlten Plan erweiterbar
- Datenmodell passt gut zu Reisen, Mitgliedern, Packlisten, Einkauf und Essen

## Alternative

Firebase Free Tier ist ebenfalls möglich. Es ist schnell für Realtime-Apps, aber das Datenmodell wird bei komplexeren Abfragen schneller unübersichtlich. Für diese App ist Supabase wahrscheinlich angenehmer.

## Datenmodell

Tabellen:

- `profiles`: Nutzerprofil
- `trips`: Reise mit Name, Ziel, Zeitraum, Besitzer und gespeicherten Gerichten
- `trip_members`: wer darf an welcher Reise mitarbeiten
- `global_items`: persönliche globale Packideen
- `trip_items`: konkrete Packlisten- und Einkaufs-Einträge einer Reise
- `meal_templates`: eigene gespeicherte Gerichte mit Zutaten
- `activity`: Verlauf für Änderungen

Wichtige Felder für `trip_items`:

- `id`
- `trip_id`
- `name`
- `category`
- `item_group`
- `assignee_id`
- `assignee_name`
- `packed`
- `shopping`
- `bought`
- `quantity`
- `note`
- `created_by`
- `updated_at`

## Sicherheitsidee

Supabase Row Level Security:

- Nutzer dürfen nur Reisen sehen, in denen sie Mitglied sind.
- Nur Mitglieder dürfen Einträge erstellen oder ändern.
- Eigene Gerichte gehören dem jeweiligen Nutzer.
- Einladungen laufen am Anfang über einen einfachen Einladungscode pro Reise.

## Umsetzungsschritte

1. Lokale App stabil machen und Bedienung testen.
2. PWA-Installation und Offline-Start prüfen.
3. Supabase-Projekt im kostenlosen Plan anlegen.
4. SQL aus `supabase/schema.sql` im Supabase SQL Editor ausführen.
5. Auth einbauen.
6. Lokale Speicherung durch Cloud-Speicherung ergänzen.
7. Realtime-Sync für offene Listen aktivieren.
8. Export/Import als Backup behalten.

## Handy-App-Weg

Phase 1: Progressive Web App.

- läuft im Browser
- kann auf Android und iPhone zum Home-Bildschirm hinzugefügt werden
- kein App Store nötig
- Hosting kann kostenlos über Netlify, Vercel oder GitHub Pages laufen

Phase 2: Verpackung mit Capacitor, falls nötig.

- dieselbe Web-App wird in eine Android/iOS-App verpackt
- sinnvoll, wenn Push-Benachrichtigungen, Kamera, Kontakte oder App-Store-Verteilung wichtig werden
- für den Anfang nicht nötig

## Kosten

Für private Nutzung und kleine Gruppen sollte der Supabase Free Tier am Anfang reichen. Wenn die App sehr viele Nutzer, Dateien oder Realtime-Verbindungen bekommt, müsste man später neu entscheiden.
