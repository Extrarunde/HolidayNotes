# App-Release-Checkliste

## Vor der öffentlichen Bereitstellung

- [ ] `supabase/schema.sql` im produktiven Projekt ausführen
- [ ] Zwei-Konten-Test für Freunde und gemeinsame Reisen durchführen
- [ ] Name, Anschrift und Kontakt-E-Mail in den Anbieterinformationen eintragen
- [ ] Datenschutzerklärung durch den tatsächlichen Anbieter prüfen und ergänzen
- [ ] Produktive HTTPS-Domain bereitstellen
- [ ] Supabase Site URL und Redirect URLs auf die Domain setzen
- [ ] Passwort-Zurücksetzen auf der produktiven Domain testen
- [ ] Konto- und Datenlöschung mit einem Testkonto prüfen
- [ ] Offline-Änderung und spätere Synchronisierung testen
- [ ] PWA-Installation auf Android und iPhone testen

## Store-Verpackung

- [x] Capacitor-Konfiguration und Web-Build anlegen
- [x] Vorläufige App-ID `com.holidaynotes.app` festlegen
- [ ] App-ID vor Veröffentlichung rechtlich und organisatorisch bestätigen
- [ ] Android mit `npm install @capacitor/android` und `npx cap add android` anlegen
- [ ] iOS auf einem Mac mit `npm install @capacitor/ios` und `npx cap add ios` anlegen
- [ ] Android Signing Key sicher erzeugen und sichern
- [ ] Apple Developer Team und Signierung konfigurieren
- [ ] Store-Screenshots und Beschreibung erstellen
- [ ] Datenschutzangaben in Google Play und App Store ausfüllen
- [ ] Support- und Datenschutz-URL veröffentlichen
- [ ] Interne Testversion verteilen

## Sicherheitsprüfung

- [ ] Fremde Reisen dürfen nicht direkt per ID abrufbar sein
- [ ] Nur Besitzer dürfen Reisen löschen oder Mitglieder verwalten
- [ ] Mitglieder dürfen nur berechtigte Reisedaten bearbeiten
- [ ] Kein `service_role`-Key befindet sich im Client oder Repository
- [ ] RLS bleibt auf allen Cloud-Tabellen aktiviert
