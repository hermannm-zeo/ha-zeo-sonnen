"""Constants for the ZEO sonnenBatterie integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "zeo_sonnen"
MANUFACTURER: Final = "sonnen"

DEFAULT_SCAN_INTERVAL: Final = 10  # seconds; short keeps the kWh counters accurate
MIN_SCAN_INTERVAL: Final = 5
MAX_SCAN_INTERVAL: Final = 300

# Settings in /api/v2/configurations
CONF_KEY_SERIAL: Final = "DE_Ticket_Number"
CONF_KEY_OPERATING_MODE: Final = "EM_OperatingMode"
CONF_KEY_BACKUP_RESERVE: Final = "EM_USOC"
CONF_KEY_MODULES: Final = "IC_BatteryModules"
CONF_KEY_MODULE_CAPACITY: Final = "CM_MarketingModuleCapacity"  # Wh per module

# Operating modes the select offers: option -> value the battery uses.
OPERATING_MODES: Final = {
    "manual": "1",
    "automatic": "2",
    "time_of_use": "10",
    "optimisation": "11",
}

# --- ZEO additions -------------------------------------------------------
CONF_MODEL: Final = "model"

# Battery model as chosen by the installer. The local API reports no model
# name, so this cannot be detected reliably. `color` is the housing colour the
# dashboard card draws.
MODELS: Final = {
    "performance": {"label": "sonnenBatterie Performance", "color": "black"},
    "performance_plus": {"label": "sonnenBatterie Performance+", "color": "black"},
    "eco": {"label": "sonnenBatterie 10 / eco", "color": "white"},
    "hybrid": {"label": "sonnenBatterie hybrid", "color": "grey"},
}
DEFAULT_MODEL: Final = "performance"

# Backup unit (sonnenProtect) as chosen by the installer.
CONF_PROTECT: Final = "protect"
PROTECTS: Final = ("none", "protect_4000", "protect_8000")
DEFAULT_PROTECT: Final = "none"

# Combinations that have backup power. Only these get the backup reserve
# (Notstrompuffer) in the dashboard. The Performance+ has it built in.
BACKUP_COMBOS: Final = {
    ("performance", "protect_8000"),
    ("performance_plus", "none"),
    ("eco", "protect_4000"),
}


def protect_fits(model: str, protect: str) -> bool:
    """A Protect unit only fits the model it is made for."""
    return protect == "none" or (model, protect) in BACKUP_COMBOS


def has_backup(model: str, protect: str) -> bool:
    """True if this model/Protect combination provides backup power."""
    return (model, protect) in BACKUP_COMBOS


# Frontend shipped with the integration
FRONTEND_URL_BASE: Final = "/zeo_sonnen_static"
CARD_FILENAME: Final = "zeo-sonnen-card.js"
PANEL_ELEMENT: Final = "zeo-sonnen-panel"
PANEL_ICON: Final = "mdi:battery-charging-high"
