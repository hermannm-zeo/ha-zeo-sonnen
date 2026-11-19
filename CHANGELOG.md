# Changelog

## Unveröffentlicht

### Neu
- **Eigener OCPP-1.6J-Server** für den sonnenCharger 3 (Alfen Eve) auf dem HA-Port 8123: `ws://<HA-IP>:8123/api/zeo_sonnen/ocpp/` (die Box hängt ihre ID selbst an). Kein zusätzlicher Port, nur Verbindungen aus dem lokalen Netz, keine über Home Assistant Cloud
- Verarbeitet Boot, Heartbeat, Status, Messwerte (Energie, Leistung und Strom je Phase, angebotener Strom, Spannung), Autorisierung und Ladevorgänge; setzt die Uhr der Box und merkt sich die Zeitabweichung
- Fragt nach dem Verbinden den Status der Box ab
- Noch ohne Entitäten und ohne Steuerung (folgt)
- Regelkern `charge_logic.py` für die Lademodi Aus/Eco/Eco+/Power/Manuell mit Tests; Testaufbau als pyscript unter `tools/pyscript/`

### Geändert
- Neue Abhängigkeit `ocpp>=2.1.0`

## v0.5.0

### Neu
- **Zwei Dashboards zur Auswahl** bei Einrichtung und unter **Konfigurieren**: „sonnenBatterie Modern“ (Hausansicht mit Energiefluss, Standard), „sonnenBatterie Classic“ (bisheriges Portal) oder beide. Bestehende Einträge behalten Classic
- **Hauskarte** `custom:zeo-sonnen-3d-card` (Modern): Hausbild mit Tag/Nacht-Wechsel nach Sonnenstand, runde Wertanzeigen, animierte Energieflüsse (Tempo nach Leistung), Jetzt/Heute, Autarkie und Eigenverbrauch, Batteriekarte mit Restlaufzeit, Tagesverlauf und Auswertung Tag/Woche/Monat/Jahr, Betriebsart und Notstrompuffer mit Bestätigung, heller und dunkler Modus
- Hauskarte optional mit Wallbox und Wärmepumpe (nur wenn in der Karte eingetragen)
- Modell **sonnenBatterie Performance+**
- Auswahl **Notstrom (sonnenProtect)** bei Einrichtung und in den Optionen: Keins, Protect 4000, Protect 8000. Unpassende Kombinationen werden abgelehnt
- `zeo_sonnen/info` liefert `protect` und `backup`

### Geändert
- **Cache-Buster**: Die Kartendateien laden mit Version und Prüfsumme der Frontend-Dateien. Nach einem Update zeigt der Browser sofort die neuen Karten (vorher hielten Browser und Service Worker alte Stände)
- Seitenleisten-Einträge heißen „sonnenBatterie Classic“ bzw. „sonnenBatterie Modern“
- `zeo_sonnen/info` liefert zusätzlich Lade- und Entladeenergie der Batterie
- Notstrompuffer (Einstellung und Anzeige „Min. Notstrompuffer“) erscheint im Portal nur noch bei Performance mit Protect 8000, Performance+ und sonnenBatterie 10 mit Protect 4000. Bestehende Einträge stehen auf „Keins“ und müssen bei vorhandenem Protect unter **Konfigurieren** umgestellt werden

### Behoben
- Auswertung im Classic-Portal: Rückkehr zum aktuellen Tag funktioniert wieder, Sommer-/Winterzeit überspringt keinen Tag, „›“ ist am heutigen Tag gesperrt

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
