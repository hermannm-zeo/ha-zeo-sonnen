"""Config flow: host, API token and model, plus re-auth, reconfigure (incl. a
replaced power unit) and options."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_API_TOKEN, CONF_HOST, CONF_SCAN_INTERVAL
from homeassistant.core import callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import SonnenApi, SonnenAuthError, SonnenError, normalise_host
from .const import (
    CONF_KEY_SERIAL,
    CONF_MODEL,
    DEFAULT_MODEL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
    MODELS,
)
from .schema import vol

_LOGGER = logging.getLogger(__name__)

_TOKEN_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
_MODEL_SELECTOR = SelectSelector(
    SelectSelectorConfig(options=list(MODELS), mode=SelectSelectorMode.LIST, translation_key="model")
)


def _user_schema(defaults: Mapping[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, "")): str,
            vol.Required(CONF_API_TOKEN): _TOKEN_SELECTOR,
        }
    )


def _setup_schema(defaults: Mapping[str, Any]) -> vol.Schema:
    return _user_schema(defaults).extend(
        {vol.Required(CONF_MODEL, default=defaults.get(CONF_MODEL, DEFAULT_MODEL)): _MODEL_SELECTOR}
    )


def migrate_unique_ids(hass: Any, entry: ConfigEntry, old: str, new: str) -> None:
    """Move entities and the device from the old serial to the new one, so
    entity IDs, history and dashboards survive a replaced power unit."""
    ent_reg = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(ent_reg, entry.entry_id):
        if entity.unique_id.startswith(f"{old}_"):
            ent_reg.async_update_entity(entity.entity_id, new_unique_id=new + entity.unique_id[len(old) :])
    dev_reg = dr.async_get(hass)
    if (device := dev_reg.async_get_device(identifiers={(DOMAIN, old)})) is not None:
        dev_reg.async_update_device(device.id, new_identifiers={(DOMAIN, new)}, serial_number=new)


class SonnenConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    _pending: dict[str, Any]
    _new_unique_id: str | None = None

    async def _async_validate(self, host: str, token: str) -> tuple[str | None, dict[str, str]]:
        """Returns (unique id, errors)."""
        api = SonnenApi(async_get_clientsession(self.hass), host, token)
        try:
            await api.async_get_status()
            configurations = await api.async_get_configurations()
        except SonnenAuthError:
            return None, {"base": "invalid_auth"}
        except SonnenError:
            return None, {"base": "cannot_connect"}
        except Exception:
            _LOGGER.exception("Unexpected error talking to the battery")
            return None, {"base": "unknown"}
        serial = str(configurations.get(CONF_KEY_SERIAL) or "").strip()
        return serial or api.base_url, {}

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            host = normalise_host(user_input[CONF_HOST])
            unique_id, errors = await self._async_validate(host, user_input[CONF_API_TOKEN])
            if not errors:
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured(updates={CONF_HOST: host})
                return self.async_create_entry(
                    title=MODELS[user_input[CONF_MODEL]]["label"],
                    data={
                        CONF_HOST: host,
                        CONF_API_TOKEN: user_input[CONF_API_TOKEN],
                        CONF_MODEL: user_input[CONF_MODEL],
                    },
                )
        return self.async_show_form(
            step_id="user", data_schema=_setup_schema(user_input or {}), errors=errors
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            _, errors = await self._async_validate(entry.data[CONF_HOST], user_input[CONF_API_TOKEN])
            if not errors:
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_API_TOKEN: user_input[CONF_API_TOKEN]}
                )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_API_TOKEN): _TOKEN_SELECTOR}),
            description_placeholders={"host": entry.data[CONF_HOST]},
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            host = normalise_host(user_input[CONF_HOST])
            unique_id, errors = await self._async_validate(host, user_input[CONF_API_TOKEN])
            if not errors:
                self._pending = {CONF_HOST: host, CONF_API_TOKEN: user_input[CONF_API_TOKEN]}
                if unique_id != entry.unique_id:
                    # A different serial: usually the power unit was replaced.
                    await self.async_set_unique_id(unique_id)
                    self._abort_if_unique_id_configured()
                    self._new_unique_id = unique_id
                    return await self.async_step_replace_unit()
                return self.async_update_reload_and_abort(entry, data_updates=self._pending)
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=_user_schema(user_input or entry.data),
            errors=errors,
        )

    async def async_step_replace_unit(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirm taking over a new serial number for this entry."""
        entry = self._get_reconfigure_entry()
        old, new = str(entry.unique_id), str(self._new_unique_id)
        if user_input is not None:
            migrate_unique_ids(self.hass, entry, old, new)
            return self.async_update_reload_and_abort(
                entry, unique_id=new, data_updates=self._pending, reason="unit_replaced"
            )
        return self.async_show_form(
            step_id="replace_unit",
            data_schema=vol.Schema({}),
            description_placeholders={"old": old, "new": new},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> SonnenOptionsFlow:
        return SonnenOptionsFlow()


class SonnenOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(
                data={
                    CONF_SCAN_INTERVAL: int(user_input[CONF_SCAN_INTERVAL]),
                    CONF_MODEL: user_input[CONF_MODEL],
                }
            )
        current = self.config_entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        model = self.config_entry.options.get(
            CONF_MODEL, self.config_entry.data.get(CONF_MODEL, DEFAULT_MODEL)
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_MODEL, default=model): _MODEL_SELECTOR,
                    vol.Required(CONF_SCAN_INTERVAL, default=current): NumberSelector(
                        NumberSelectorConfig(
                            min=MIN_SCAN_INTERVAL,
                            max=MAX_SCAN_INTERVAL,
                            step=1,
                            unit_of_measurement="s",
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
        )
