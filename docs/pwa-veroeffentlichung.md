# PWA-Veröffentlichung

Für Holiday Notes ist zuerst eine Webanwendung/PWA sinnvoll. Sie läuft auf Android und iPhone, lässt sich zum Home-Bildschirm hinzufügen und kann später ohne App-Store-Freigabe aktualisiert werden.

## Empfehlung

1. Als PWA veröffentlichen.
2. Auf echten Handys testen.
3. Erst danach entscheiden, ob zusätzlich Google Play oder App Store nötig ist.

## Release bauen

```powershell
npm.cmd run release:web
```

Der fertige Build liegt danach in `dist`.

## Hosting

Geeignete Anbieter:

- Netlify: `netlify.toml` ist vorbereitet, Publish-Ordner ist `dist`.
- Vercel: `vercel.json` ist vorbereitet, Output Directory ist `dist`.
- Cloudflare Pages: Build Command `npm run release:web`, Output Directory `dist`.

Wichtig: Die App muss über HTTPS laufen, sonst funktionieren PWA-Installation, Service Worker und Login-Flows nicht zuverlässig.

Beim Hosting müssen diese Umgebungsvariablen gesetzt werden, wenn `config/supabase-config.js` nicht mit hochgeladen wird:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Der anon key ist ein öffentlicher Browser-Key, kein geheimer `service_role`-Key.

## Supabase nach Veröffentlichung

Nach der ersten echten URL:

1. Supabase öffnen.
2. Authentication > URL Configuration.
3. Site URL auf die neue HTTPS-Adresse setzen.
4. Redirect URLs ergänzen:
   - `https://deine-domain.de`
   - `https://deine-domain.de/`
   - `https://deine-domain.de/index.html`
5. Anmeldung, Passwort vergessen und Profil speichern auf dem Handy testen.

## Handy-Test

Android:

1. Chrome öffnen.
2. Produktions-URL öffnen.
3. Installieren bzw. Zum Startbildschirm hinzufügen.
4. Offline öffnen, danach wieder online synchronisieren.

iPhone:

1. Safari öffnen.
2. Produktions-URL öffnen.
3. Teilen > Zum Home-Bildschirm.
4. Icon starten und Login testen.

## Updates

Für jedes Update:

1. Code ändern.
2. Version in `index.html` und `service-worker.js` erhöhen, wenn CSS/JS geändert wurden.
3. `npm.cmd run release:web` ausführen.
4. `dist` neu veröffentlichen.
5. Auf dem Handy App einmal schließen und neu öffnen.

## Später als Store-App

Capacitor ist vorbereitet. Für Store-Releases fehlen später noch:

- Android/iOS-Plattform hinzufügen
- Signing Keys
- Store-Screenshots
- Datenschutz- und Support-URLs
- interne Testversion
