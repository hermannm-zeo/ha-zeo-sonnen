# Changelog

## Unreleased

### Neu
- Modell **sonnenBatterie Performance+**
- Auswahl **Notstrom (sonnenProtect)** bei Einrichtung und in den Optionen: Keins, Protect 4000, Protect 8000. Unpassende Kombinationen werden abgelehnt
- `zeo_sonnen/info` liefert `protect` und `backup`

### Geändert
- Notstrompuffer (Einstellung und Anzeige „Min. Notstrompuffer“) erscheint im Portal nur noch bei Performance mit Protect 8000, Performance+ und sonnenBatterie 10 mit Protect 4000. Bestehende Einträge stehen auf „Keins“ und müssen bei vorhandenem Protect unter **Konfigurieren** umgestellt werden

## v0.4.1

### Neu
- ZEO-Icon und -Logo für Integration und Marketplace (vorläufig, aus dem Logo der Homepage abgeleitet)

## v0.4.0

Erste ZEO-Version, Fork von zafayar/ha-sonnen-battery v0.3.0 (MIT).

### Neu
- **Kundenportal** als Seitenleisten-Eintrag „sonnenBatterie“ je Batterie: Übersicht, Energiefluss live, Auswertung, sonnenBatterie
- **Karte** `custom:zeo-sonnen-card` für eigene Dashboards, wird automatisch geladen
- **Modellauswahl** bei Einrichtung und in den Optionen: Performance (schwarz), 10 / eco (weiß), hybrid (grau), bestimmt die Gehäusefarbe im Portal
- **Power-Unit-Tausch**: „Neu konfigurieren“ übernimmt eine neue Seriennummer, Entitäten, Entity-IDs und Verlauf bleiben erhalten
- **Statuslicht**: alle 16 Eclipse-LED-Zustände (u. a. lila pulsierend bei Battery Care)
- Websocket-Befehl `zeo_sonnen/info` (Entitäten und Modell einer Batterie)
- Deutsche Übersetzung, Firmware-Version im Geräteregister

### Geändert
- Domain `zeo_sonnen` statt `sonnen_battery`, neue Installation nötig
- sonnen-Logo entfernt
