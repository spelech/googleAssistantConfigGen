import logging
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig

from .const import DOMAIN
from .views import EntitiesView, UpdateEntityView, SyncView

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Google Assistant Entity Console component (legacy YAML fallback)."""
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the Google Assistant Entity Console from a config entry."""
    _LOGGER.info("Setting up Google Assistant Entity Console from config entry")

    # 1. Register static files directory
    static_dir = hass.config.path("custom_components/google_assistant_entity_console/static")
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            "/google_assistant_entity_console/static",
            static_dir,
            True,
        )
    ])

    # 2. Register API views
    hass.http.register_view(EntitiesView())
    hass.http.register_view(UpdateEntityView())
    hass.http.register_view(SyncView())

    # 3. Register Sidebar Panel
    async_remove_panel(hass, DOMAIN, warn_if_unknown=False)

    async_register_built_in_panel(
        hass=hass,
        component_name="custom",
        sidebar_title="Google Sync",
        sidebar_icon="mdi:google-assistant",
        frontend_url_path=DOMAIN,
        require_admin=False,
        config={
            "_panel_custom": {
                "name": "google-assistant-entity-console-panel",
                "js_url": "/google_assistant_entity_console/static/panel.js",
            }
        },
    )

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.info("Unloading Google Assistant Entity Console config entry")
    async_remove_panel(hass, DOMAIN, warn_if_unknown=False)
    return True
