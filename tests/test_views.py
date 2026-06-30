import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from aiohttp import web
from custom_components.google_assistant_entity_console.views import (
    load_ai_settings,
    save_ai_settings,
    AISettingsView,
    AIModelsView,
    AIGenerateNicknamesView,
    AISuggestExposureView,
    AIGenerateSingleEntityNicknameView,
)

@pytest.fixture
def mock_hass():
    hass = MagicMock()
    # Mock config path
    hass.config.path.return_value = "dummy_settings.json"
    return hass

def test_load_save_ai_settings(mock_hass):
    # Test setting loading on non-existing path
    with patch("os.path.exists", return_value=False):
        settings = load_ai_settings(mock_hass)
        assert settings == {}

    # Test saving settings
    test_settings = {"base_url": "https://api.openai.com/v1", "model": "gpt-4"}
    with patch("builtins.open", MagicMock()) as mock_open:
        save_ai_settings(mock_hass, test_settings)
        mock_open.assert_called_once_with("dummy_settings.json", "w", encoding="utf-8")


@pytest.mark.anyio
async def test_ai_settings_view_get(mock_hass):
    view = AISettingsView()
    request = MagicMock()
    request.app = {"hass": mock_hass}
    
    with patch("custom_components.google_assistant_entity_console.views.load_ai_settings", return_value={"base_url": "test"}):
        resp = await view.get(request)
        data = json.loads(resp.body.decode())
        assert data["settings"]["base_url"] == "test"


@pytest.mark.anyio
async def test_ai_models_view_post(mock_hass):
    view = AIModelsView()
    request = AsyncMock()
    request.app = {"hass": mock_hass}
    request.json.return_value = {
        "base_url": "https://api.openrouter.ai/v1",
        "api_key": "test_key"
    }

    mock_resp = AsyncMock()
    mock_resp.status = 200
    mock_resp.json.return_value = {
        "data": [
            {
                "id": "openai/gpt-4",
                "name": "GPT-4",
                "pricing": {"prompt": "0.00001", "completion": "0.00003"}
            }
        ]
    }

    mock_session = MagicMock()
    mock_session.get.return_value.__aenter__.return_value = mock_resp

    with patch("custom_components.google_assistant_entity_console.views.async_get_clientsession", return_value=mock_session):
        resp = await view.post(request)
        data = json.loads(resp.body.decode())
        assert "models" in data
        assert len(data["models"]) == 1
        assert data["models"][0]["id"] == "openai/gpt-4"
        assert data["models"][0]["pricing"]["prompt"] == "0.00001"


@pytest.mark.anyio
async def test_ai_generate_single_nickname(mock_hass):
    view = AIGenerateSingleEntityNicknameView()
    request = AsyncMock()
    request.app = {"hass": mock_hass}
    request.json.return_value = {
        "entity_id": "light.kitchen_light",
        "display_name": "Kitchen Light",
        "room_entities": [
            {"entity_id": "light.kitchen_pendant", "display_name": "Kitchen Pendant", "aliases": ["pendant"]}
        ]
    }

    mock_resp = AsyncMock()
    mock_resp.status = 200
    mock_resp.json.return_value = {
        "choices": [
            {"message": {"content": "cooking light, kitchen main"}}
        ]
    }

    mock_session = MagicMock()
    mock_session.post.return_value.__aenter__.return_value = mock_resp

    test_settings = {
        "base_url": "https://api.openrouter.ai/v1",
        "api_key": "test_key",
        "model": "openai/gpt-4"
    }

    with patch("custom_components.google_assistant_entity_console.views.load_ai_settings", return_value=test_settings), \
         patch("custom_components.google_assistant_entity_console.views.async_get_clientsession", return_value=mock_session):
        resp = await view.post(request)
        data = json.loads(resp.body.decode())
        assert "aliases" in data
        assert "cooking light" in data["aliases"]
        assert "kitchen main" in data["aliases"]
