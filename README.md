# ZEO sonnenBatterie

Home-Assistant-Integration für die sonnenBatterie über die **lokale JSON-API (v2)**, mit fertigem Kundenportal. Läuft ohne sonnen-Cloud.

Basiert auf [zafayar/ha-sonnen-battery](https://github.com/zafayar/ha-sonnen-battery) (MIT-Lizenz) und wurde von ZEO Solar erweitert.

## Was die Integration mitbringt

| Teil | Beschreibung |
|---|---|
| Entitäten | Leistung, Energiezähler (für das Energie-Dashboard), Ladestand, Zyklen, Kapazität, Systemstatus, Statuslicht, Notstrompuffer, Betriebsart |
| Seitenleiste | Eigener Eintrag **sonnenBatterie** je Batterie mit dem Kundenportal: Übersicht, Energiefluss live, Auswertung, sonnenBatterie |
| Karte | `custom:zeo-sonnen-card` für eigene Dashboards. Wird automatisch geladen, eine Ressource muss nicht angelegt werden |
| Modell | Wird bei der Einrichtung gewählt und bestimmt die Gehäusefarbe im Portal |
| Power-Unit-Tausch | „Neu konfigurieren“ erkennt eine neue Seriennummer und übernimmt sie. Entitäten, Entity-IDs und Verlauf bleiben erhalten |

### Modelle

| Auswahl | Gehäuse |
|---|---|
| sonnenBatterie Performance | schwarz |
| sonnenBatterie 10 / eco | weiß |
| sonnenBatterie hybrid | grau |

Die API meldet das Modell nicht, deshalb muss es bei der Einrichtung gewählt werden. Ändern lässt es sich später unter **Konfigurieren** der Integration.

## Installation

1. Im Marketplace (HA 2026.11+) bzw. in HACS dieses Repository als benutzerdefiniertes Repository hinzufügen, Kategorie **Integration**.
2. **ZEO sonnenBatterie** installieren und Home Assistant neu starten.
3. Im Batterie-Dashboard unter **Software-Integration** die JSON-API einschalten und den Token kopieren. Für Notstrompuffer und Betriebsart zusätzlich Schreibzugriff aktivieren.
4. **Einstellungen → Geräte & Dienste → Integration hinzufügen → ZEO sonnenBatterie**: Host, Token und Modell eintragen.

Der Seitenleisten-Eintrag **sonnenBatterie** erscheint danach automatisch.

## Karte in eigenen Dashboards

```yaml
type: custom:zeo-sonnen-card
# optional, nur bei mehreren Batterien nötig:
entry_id: 01ABC...
# optional:
default_page: flow   # overview | flow | analysis | battery
```

Die Karte fragt über den Websocket-Befehl `zeo_sonnen/info` ab, welche Entitäten zur Batterie gehören. Entity-IDs dürfen deshalb beliebig umbenannt werden.

## Hinweise

- Ein sonnen-Logo ist nicht enthalten. Die Illustration ist selbst gezeichnet. Icon und Logo der Integration sind das ZEO-SOLAR-Logo.
- `remaining_energy` kommt unverändert aus der API (`RemainingCapacity_Wh`). Während des Vollladezyklus nach einem Modultausch kann der Wert unplausibel sein. Das Portal rechnet die gespeicherte Energie deshalb aus Ladestand × Volllade-Kapazität.

## Entwicklung

```bash
pip install -r requirements_test.txt home-assistant-frontend
pytest
ruff check . && ruff format --check .
```

## Neue Version veröffentlichen

1. Version in `custom_components/zeo_sonnen/manifest.json` und `SPC_VERSION` in `frontend/zeo-sonnen-card.js` erhöhen
2. In `CHANGELOG.md` einen Abschnitt `## vX.Y.Z` mit den Änderungen ergänzen
3. Auf `main` pushen. Die Action **Release** legt Tag und GitHub-Release automatisch an, der Marketplace bietet das Update dann an.
