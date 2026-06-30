# Supabase Setup

## 1. Projekt konfigurieren

Unter Project Settings > API die Project URL und den anon public key kopieren. Der `service_role`-Key gehört niemals in die Web-App.

## 2. Anmeldung aktivieren

Unter Authentication > Providers die E-Mail-Anmeldung aktivieren. Unter URL Configuration die lokale und später die produktive App-URL hinterlegen.

## 3. Datenbank aktualisieren

Den vollständigen Inhalt von `schema.sql` im SQL Editor ausführen. Das Skript kann erneut ausgeführt werden und richtet unter anderem ein:

- RLS-Regeln für Reisen, Listen und Mitglieder
- echte Freundschaften zwischen Benutzerkonten
- automatische Realtime-Aktualisierung
- `delete_current_user` für die dauerhafte Kontolöschung

## 4. Funktionstest

1. Zwei echte Testkonten erstellen.
2. Konto A fügt Konto B über dessen E-Mail-Adresse als Freund hinzu.
3. Konto A weist Konto B einer Reise zu.
4. Beide Konten öffnen die Reise gleichzeitig in getrennten Browsern.
5. Packlistenänderungen und das Entfernen eines Mitglieds prüfen.
6. Mit einem zusätzlichen Testkonto die Kontolöschung prüfen.

## 5. Lokale Konfiguration

`config/supabase-config.example.js` nach `config/supabase-config.js` kopieren und die Projektwerte eintragen. Die lokale Konfiguration ist nicht für geheime Server-Schlüssel geeignet.
