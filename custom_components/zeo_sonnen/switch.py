"""Switch: release or block the wallbox (OCPP ChangeAvailability)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN
from .coordinator import SonnenConfigEntry
from .wallbox import WallboxDescription, WallboxEntity, wallbox_id

PARALLEL_UPDATES = 1


@dataclass(frozen=True, kw_only=True)
class WallboxSwitchDescription(WallboxDescription, SwitchEntityDescription):
    """Wallbox switch."""


WALLBOX_AVAILABLE = WallboxSwitchDescription(
    key="available",
    translation_key="wallbox_available",
    value_fn=lambda s: s.operative,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SonnenConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if (cp_id := wallbox_id(entry)) is not None:
        async_add_entities([WallboxAvailableSwitch(entry, cp_id, WALLBOX_AVAILABLE)])


class WallboxAvailableSwitch(WallboxEntity, SwitchEntity):
    """On = the box may charge; off = blocked, also for RFID cards."""

    entity_description: WallboxSwitchDescription

    @property
    def is_on(self) -> bool | None:
        value: bool | None = self.entity_description.value_fn(self.cp_state)
        return value

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)

    async def _set(self, operative: bool) -> None:
        try:
            accepted = await self._server.async_set_operative(self._cp_id, operative)
        except Exception as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="wallbox_command_failed",
                translation_placeholders={
                    "charge_point": self._cp_id,
                    "error": str(err) or type(err).__name__,
                },
            ) from err
        if not accepted:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="wallbox_rejected")
