"""Polls the battery and shares the readings with every entity."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import SonnenApi, SonnenAuthError, SonnenError
from .const import (
    CONF_MODEL,
    CONF_PROTECT,
    DEFAULT_MODEL,
    DEFAULT_PROTECT,
    DOMAIN,
    MANUFACTURER,
    MODELS,
    has_backup,
)

_LOGGER = logging.getLogger(__name__)

type SonnenConfigEntry = ConfigEntry[SonnenCoordinator]


@dataclass
class SonnenData:
    """One poll. Everything but `status` is optional: older firmware or a
    token without read access may not offer it."""

    status: dict[str, Any]
    fetched_at: float  # time.monotonic() when status arrived
    powermeter: list[dict[str, Any]] | None = None
    battery: dict[str, Any] | None = None
    configurations: dict[str, Any] | None = None
    latest_data: dict[str, Any] | None = None
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def ic_status(self) -> dict[str, Any]:
        """The status flags inside /latestdata, or {} if unavailable."""
        ic_status = (self.latest_data or {}).get("ic_status")
        return ic_status if isinstance(ic_status, dict) else {}


class SonnenCoordinator(DataUpdateCoordinator[SonnenData]):
    config_entry: SonnenConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: SonnenConfigEntry,
        api: SonnenApi,
        scan_interval: int,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval),
        )
        self.api = api
        self.serial = entry.unique_id or entry.entry_id

    @property
    def device_info(self) -> DeviceInfo:
        model = MODELS.get(self.model_key, MODELS[DEFAULT_MODEL])
        config = (self.data.configurations if self.data else None) or {}
        return DeviceInfo(
            identifiers={(DOMAIN, self.serial)},
            manufacturer=MANUFACTURER,
            model=model["label"],
            name="sonnenBatterie",
            serial_number=self.config_entry.unique_id,
            sw_version=config.get("DE_Software"),
            configuration_url=self.api.base_url,
        )

    @property
    def model_key(self) -> str:
        """Model chosen by the installer (options override the setup value)."""
        entry = self.config_entry
        return str(entry.options.get(CONF_MODEL, entry.data.get(CONF_MODEL, DEFAULT_MODEL)))

    @property
    def protect_key(self) -> str:
        """sonnenProtect chosen by the installer (options override the setup value)."""
        entry = self.config_entry
        return str(entry.options.get(CONF_PROTECT, entry.data.get(CONF_PROTECT, DEFAULT_PROTECT)))

    @property
    def has_backup(self) -> bool:
        return has_backup(self.model_key, self.protect_key)

    async def _async_update_data(self) -> SonnenData:
        try:
            status = await self.api.async_get_status()
        except SonnenAuthError as err:
            raise ConfigEntryAuthFailed(translation_domain=DOMAIN, translation_key="auth_failed") from err
        except SonnenError as err:
            raise UpdateFailed(
                translation_domain=DOMAIN,
                translation_key="update_failed",
                translation_placeholders={"error": str(err)},
            ) from err
        fetched_at = time.monotonic()

        previous = self.data
        results = await asyncio.gather(
            self.api.async_get_powermeter(),
            self.api.async_get_battery(),
            self.api.async_get_configurations(),
            self.api.async_get_latest_data(),
            return_exceptions=True,
        )
        data = SonnenData(status=status, fetched_at=fetched_at)
        names = ("powermeter", "battery", "configurations", "latest_data")
        for name, result in zip(names, results, strict=True):
            if isinstance(result, SonnenError):
                # Keep the last good value so one failed extra call doesn't
                # flap entities to unavailable.
                data.errors[name] = str(result)
                _LOGGER.debug("Optional endpoint %s failed: %s", name, result)
                setattr(data, name, getattr(previous, name, None) if previous else None)
            elif isinstance(result, BaseException):
                raise result
            else:
                setattr(data, name, result)
        return data
