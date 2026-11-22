# ZEO sonnenBatterie

Home-Assistant-Integration für die sonnenBatterie über die **lokale JSON-API (v2)**, mit fertigem Kundenportal. Läuft ohne sonnen-Cloud.

Basiert auf [zafayar/ha-sonnen-battery](https://github.com/zafayar/ha-sonnen-battery) (MIT-Lizenz) und wurde von ZEO Solar erweitert.

## Was die Integration mitbringt

| Teil | Beschreibung |
|---|---|
| Entitäten | Leistung, Energiezähler (für das Energie-Dashboard), Ladestand, Zyklen, Kapazität, Systemstatus, Statuslicht, Notstrompuffer, Betriebsart |
| Seitenleiste | **sonnenBatterie Modern** (Hausansicht mit Energiefluss) und/oder **sonnenBatterie Classic** (Portal: Übersicht, Energiefluss live, Auswertung, sonnenBatterie) je Batterie |
| Karten | `custom:zeo-sonnen-3d-card` (Modern) und `custom:zeo-sonnen-card` (Classic) für eigene Dashboards. Werden automatisch geladen, eine Ressource muss nicht angelegt werden |
| Modell | Wird bei der Einrichtung gewählt und bestimmt die Gehäusefarbe im Portal |
| Power-Unit-Tausch | „Neu konfigurieren“ erkennt eine neue Seriennummer und übernimmt sie. Entitäten, Entity-IDs und Verlauf bleiben erhalten |

### Dashboards

| Auswahl | Seitenleiste |
|---|---|
| Modern (Standard) | **sonnenBatterie Modern**: Hausbild mit Tag/Nacht, Energiefluss, Tageswerte, Auswertung, Einstellungen |
| Classic | **sonnenBatterie Classic**: Portal im Stil von my.sonnen |
| Beide | beide Einträge |

Gewählt wird bei der Einrichtung, ändern lässt es sich unter **Konfigurieren**. Einträge aus Versionen vor der Auswahl zeigen Classic.

### Modelle

| Auswahl | Gehäuse |
|---|---|
| sonnenBatterie Performance | schwarz |
| sonnenBatterie Performance+ | schwarz |
| sonnenBatterie 10 / eco | weiß |
| sonnenBatterie hybrid | grau |

Die API meldet das Modell nicht, deshalb muss es bei der Einrichtung gewählt werden. Ändern lässt es sich später unter **Konfigurieren** der Integration.

### Notstrom (sonnenProtect)

Den **Notstrompuffer** zeigt das Portal nur bei Anlagen mit Notstrom an:

| Modell | Notstrom |
|---|---|
| Performance | nur mit sonnenProtect 8000 |
| Performance+ | integriert, Auswahl „Keins“ |
| sonnenBatterie 10 / eco | nur mit sonnenProtect 4000 |
| hybrid | nein |

Andere Kombinationen lehnt die Einrichtung ab. Die Entität `number.*_backup_reserve` bleibt in jedem Fall erhalten.

## Installation

1. Im Marketplace (HA 2026.11+) bzw. in HACS dieses Repository als benutzerdefiniertes Repository hinzufügen, Kategorie **Integration**.
2. **ZEO sonnenBatterie** installieren und Home Assistant neu starten.
3. Im Batterie-Dashboard unter **Software-Integration** die JSON-API einschalten und den Token kopieren. Für Notstrompuffer und Betriebsart zusätzlich Schreibzugriff aktivieren.
4. **Einstellungen → Geräte & Dienste → Integration hinzufügen → ZEO sonnenBatterie**: Host, Token, Modell, sonnenProtect und Dashboard eintragen.

Die Seitenleisten-Einträge erscheinen danach automatisch.

## Karten in eigenen Dashboards

### Modern (Hausansicht)

```yaml
type: custom:zeo-sonnen-3d-card
# alles optional:
entry_id: 01ABC...          # nur bei mehreren Batterien nötig
title: Mein Energiefluss
theme: auto                 # auto (folgt Home Assistant) | light | dark
backup: true                # Notstrompuffer erzwingen (true) oder ausblenden (false), sonst aus der Einrichtung
max_power: 15000            # W, Skala für das Tempo der Flusspunkte (sonst Höchstwert der letzten 7 Tage)
threshold: 30               # W, kleinere Leistungen gelten als 0
wallbox: sensor.wallbox_leistung          # Kreis „Wallbox“
wallbox_energy: sensor.wallbox_energie    # für „Heute“
wallbox_included: true      # Wallbox hängt hinter der sonnen-Messung (Linie vom Verbrauch)
heatpump: sensor.waermepumpe_leistung     # Kreis „Wärmepumpe“
heatpump_energy: sensor.waermepumpe_energie
heatpump_included: true
bg_day: /local/haus-tag.jpg    # eigene Hintergrundbilder (1365 × 768)
bg_night: /local/haus-nacht.jpg
```

Ohne Angaben zeigt die Karte nur Daten der sonnenBatterie. Wallbox und Wärmepumpe erscheinen nur, wenn sie eingetragen sind.

### Classic (Portal)

```yaml
type: custom:zeo-sonnen-card
# optional, nur bei mehreren Batterien nötig:
entry_id: 01ABC...
# optional:
default_page: flow   # overview | flow | analysis | battery
backup: true         # Notstrompuffer erzwingen (true) oder ausblenden (false), sonst aus der Einrichtung
```

Die Karte fragt über den Websocket-Befehl `zeo_sonnen/info` ab, welche Entitäten zur Batterie gehören. Entity-IDs dürfen deshalb beliebig umbenannt werden.

## Hinweise

- Ein sonnen-Logo ist nicht enthalten. Die Illustration im Classic-Portal ist selbst gezeichnet, die Hausbilder der Modern-Ansicht sind KI-generiert (Gemini). Icon und Logo der Integration sind das ZEO-SOLAR-Logo.
- `remaining_energy` kommt unverändert aus der API (`RemainingCapacity_Wh`). Während des Vollladezyklus nach einem Modultausch kann der Wert unplausibel sein. Das Portal rechnet die gespeicherte Energie deshalb aus Ladestand × Volllade-Kapazität.

## Fahrzeugkatalog

Die Wallbox-Karte bietet unter **Fahrzeug** eine Auswahl Marke → Modell → Ausführung (rund 1.200 Ausführungen, auch ältere Fahrzeuge) oder die freie Eingabe. Gespeichert werden nutzbare Akkugröße, AC-Ladeleistung und Phasen, je Haushalt bis zu 10 Fahrzeuge, eines davon ist aktiv. Grundlage für das Zielladen.

Der Katalog `custom_components/zeo_sonnen/vehicles.json` wird mit `python3 tools/build_vehicle_db.py` aus zwei offenen Datensätzen gebaut und mit der Integration ausgeliefert (keine Online-Abfrage):

- **OpenEV Data**, https://github.com/open-ev-data/open-ev-data-dataset, Lizenz [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/)
- **Open EV Data**, https://github.com/KilowattApp/open-ev-data, MIT-Lizenz mit Namensnennung

Das Skript vereinheitlicht Marken, trennt Modell und Ausführung, verwirft unplausible Werte (AC über 22 kW, 7,4 kW dreiphasig) und führt gleiche Ausführungen zusammen. Eigene Ergänzungen und Korrekturen kommen nach `tools/vehicles_extra.json` (nur mit Quelle aus dem Herstellerdatenblatt). Die Daten sind ohne Gewähr, der Kunde kann jeden Wert in der Karte ändern.

Websocket-Befehle: `zeo_sonnen/vehicles/catalog` (Marken, Modelle, Ausführungen), `…/search`, `…/list`, `…/save`, `…/delete`, `…/activate`.

## Entwicklung

```bash
pip install -r requirements_test.txt home-assistant-frontend
pytest
ruff check . && ruff format --check .
```

## Neue Version veröffentlichen

1. Version in `custom_components/zeo_sonnen/manifest.json`, `SPC_VERSION` in `frontend/zeo-sonnen-card.js` und `Z3_VERSION` in `frontend/zeo-sonnen-3d-card.js` erhöhen
2. In `CHANGELOG.md` einen Abschnitt `## vX.Y.Z` mit den Änderungen ergänzen
3. Auf `main` pushen. Die Action **Release** legt Tag und GitHub-Release automatisch an, der Marketplace bietet das Update dann an.
