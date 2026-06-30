import logging
import os
import re
from aiohttp import web
import yaml

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry,
    device_registry,
    entity_registry,
    floor_registry,
)
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class Secret:
    def __init__(self, value: str):
        self.value = value

class Include:
    def __init__(self, value: str):
        self.value = value

def secret_representer(dumper, data):
    return dumper.represent_scalar('!secret', data.value)

def include_representer(dumper, data):
    return dumper.represent_scalar('!include', data.value)

# Register representers on SafeDumper
yaml.SafeDumper.add_representer(Secret, secret_representer)
yaml.SafeDumper.add_representer(Include, include_representer)


import json

def load_blocklist(hass: HomeAssistant) -> list:
    filepath = hass.config.path("google_assistant_entity_console_blocklist.json")
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except Exception as err:
        _LOGGER.error("Failed to load blocklist: %s", err)
    return []

def save_blocklist(hass: HomeAssistant, blocklist: list):
    filepath = hass.config.path("google_assistant_entity_console_blocklist.json")
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(blocklist, f, indent=2)
    except Exception as err:
        _LOGGER.error("Failed to save blocklist: %s", err)

def _read_file_content(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


async def get_current_yaml_filename(hass: HomeAssistant):
    config_path = hass.config.path("configuration.yaml")
    try:
        config_content = await hass.async_add_executor_job(_read_file_content, config_path)
        include_pattern = r"google_assistant:\s*!include\s*(gaGen_\d{6}\.yaml)"
        match = re.search(include_pattern, config_content)
        if match:
            return match.group(1)
    except FileNotFoundError:
        pass
    except Exception as err:
        _LOGGER.error("Failed to read configuration.yaml: %s", err)
    return None


async def load_yaml_exposed_entities(hass: HomeAssistant, filename: str):
    if not filename:
        return {}
    filepath = hass.config.path(filename)
    
    try:
        class CustomLoader(yaml.SafeLoader):
            pass
        CustomLoader.add_constructor('!secret', lambda loader, node: node.value)
        CustomLoader.add_constructor('!include', lambda loader, node: node.value)
        
        content = await hass.async_add_executor_job(_read_file_content, filepath)
        
        data = yaml.load(content, Loader=CustomLoader)
        if data and isinstance(data, dict):
            entity_config = data.get("entity_config", {})
            exposed = {}
            for ent_id, cfg in entity_config.items():
                if isinstance(cfg, dict) and cfg.get("expose", False):
                    exposed[ent_id] = {
                        "name": cfg.get("name"),
                        "aliases": cfg.get("aliases", []),
                        "room": cfg.get("room")
                    }
            return exposed
    except FileNotFoundError:
        pass
    except Exception as err:
        _LOGGER.error("Failed to load/parse yaml file %s: %s", filename, err)
    return {}


async def async_fetch_entities_data(hass: HomeAssistant):
    ent_reg = entity_registry.async_get(hass)
    dev_reg = device_registry.async_get(hass)
    area_reg = area_registry.async_get(hass)
    floor_reg = floor_registry.async_get(hass)

    # Identify all light group members in Home Assistant
    light_group_members = set()
    for state in hass.states.async_all("light"):
        if state.attributes and "entity_ids" in state.attributes:
            members = state.attributes.get("entity_ids")
            if isinstance(members, list):
                for m in members:
                    light_group_members.add(m)
    for state in hass.states.async_all("group"):
        if state.attributes and "entity_ids" in state.attributes:
            members = state.attributes.get("entity_ids")
            if isinstance(members, list):
                for m in members:
                    if m.startswith("light."):
                        light_group_members.add(m)

    # Build area name and floor mapping
    area_map = {}
    area_floor_map = {}
    for area in area_reg.async_list_areas():
        area_map[area.id] = area.name
        area_floor_map[area.id] = area.floor_id

    # Build floor name mapping
    floor_map = {floor.floor_id: floor.name for floor in floor_reg.async_list_floors()}

    # Load currently exposed YAML config to compare
    yaml_filename = await get_current_yaml_filename(hass)
    yaml_exposed = await load_yaml_exposed_entities(hass, yaml_filename)

    # Build device mappings
    device_area_map = {}
    device_name_map = {}
    for device in dev_reg.devices.values():
        device_area_map[device.id] = device.area_id
        device_name_map[device.id] = device.name_by_user or device.name

    # Load blocklist
    blocklist = load_blocklist(hass)
    compiled_blocklist = []
    for pattern in blocklist:
        try:
            compiled_blocklist.append(re.compile(pattern))
        except re.error as err:
            _LOGGER.error("Invalid regex in blocklist '%s': %s", pattern, err)

    active_entities = []
    for entry in ent_reg.entities.values():
        # Filter out disabled and hidden entities
        if entry.disabled_by or entry.hidden_by:
            continue

        entity_id = entry.entity_id

        # Check blocklist
        is_blocked = False
        for rx in compiled_blocklist:
            if rx.search(entity_id):
                is_blocked = True
                break
        if is_blocked:
            continue

        device_id = entry.device_id
        domain = entity_id.split(".")[0]

        # Filter supported domains and specific device classes as per Google Assistant integration docs
        device_class = entry.device_class or entry.original_device_class or ""
        supported_domains = {
            "alarm_control_panel", "button", "camera", "climate", "cover", "fan",
            "group", "humidifier", "input_boolean", "input_button", "input_select",
            "light", "lawn_mower", "lock", "media_player", "scene", "script",
            "select", "switch", "vacuum", "valve", "water_heater"
        }

        if domain not in supported_domains:
            if domain == "binary_sensor":
                if device_class not in {"carbon_monoxide", "door", "garage_door", "lock", "moisture", "opening", "smoke", "window"}:
                    continue
            elif domain == "event":
                if device_class != "doorbell":
                    continue
            elif domain == "sensor":
                if device_class not in {"aqi", "carbon_dioxide", "carbon_monoxide", "humidity", "pm10", "pm25", "temperature", "volatile_organic_compounds"}:
                    continue
            else:
                continue

        # Resolve Area and Floor
        area_id = entry.area_id
        if not area_id and device_id:
            area_id = device_area_map.get(device_id)
        
        area_name = "TBA"
        floor_name = "TBA"
        if area_id:
            area_name = area_map.get(area_id, "TBA")
            floor_id = area_floor_map.get(area_id)
            if floor_id:
                floor_name = floor_map.get(floor_id, "TBA")

        # Resolve Display Name
        display_name = entry.name
        if not display_name and device_id:
            display_name = device_name_map.get(device_id)
        if not display_name:
            display_name = entry.original_name
        if not display_name:
            # Fallback to formatting entity ID name part
            name_part = entity_id.split(".")[-1]
            display_name = name_part.replace("_", " ").title()

        # Resolve should_expose
        should_expose = False
        if entry.options and "conversation" in entry.options:
            should_expose = entry.options["conversation"].get("should_expose", False)

        # Compare with what is in the yaml file
        yaml_exp = entity_id in yaml_exposed

        # Clean/filter aliases
        raw_aliases = entry.aliases or []
        clean_aliases = [a for a in raw_aliases if a and a != "0" and a != 0]

        platform = entry.platform or ""
        device_class = entry.device_class or ""
        in_group = entity_id in light_group_members

        active_entities.append({
            "entity_id": entity_id,
            "name": entry.name,
            "original_name": entry.original_name,
            "display_name": display_name,
            "device_class": device_class,
            "platform": platform,
            "should_expose": should_expose,
            "yaml_exposed": yaml_exp,
            "area": area_name,
            "floor": floor_name,
            "domain": domain,
            "aliases": clean_aliases,
            "in_group": in_group
        })

    return active_entities


class EntitiesView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/entities"
    name = "api:google_assistant_entity_console:entities"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            entities = await async_fetch_entities_data(hass)
            yaml_filename = (await get_current_yaml_filename(hass)) or "None"
            
            # Read version natively via Home Assistant loader
            from homeassistant.loader import async_get_integration
            try:
                integration = await async_get_integration(hass, DOMAIN)
                version = integration.version
            except Exception:
                version = "Unknown"

            return self.json({
                "entities": entities,
                "yaml_filename": yaml_filename,
                "version": version
            })
        except Exception as err:
            _LOGGER.exception("Failed to fetch entities registry")
            return self.json({"error": str(err)}, status=500)


class UpdateEntityView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/entities/update"
    name = "api:google_assistant_entity_console:entities:update"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            entity_id = body.get("entity_id")
            name = body.get("name")
            aliases = body.get("aliases")
            should_expose = body.get("should_expose")

            if not entity_id:
                return self.json({"error": "Missing entity_id"}, status=400)

            ent_reg = entity_registry.async_get(hass)
            entry = ent_reg.async_get(entity_id)
            if not entry:
                return self.json({"error": f"Entity {entity_id} not found"}, status=404)

            # Filter out any "0", 0, or empty values from aliases
            clean_aliases = None
            if aliases is not None:
                clean_aliases = [a for a in aliases if a and a != "0" and a != 0]

            # Update entry details
            ent_reg.async_update_entity(
                entity_id,
                name=name if name else None,
                aliases=set(clean_aliases) if clean_aliases is not None else None
            )

            # Update conversation (exposure) option namespace
            ent_reg.async_update_entity_options(
                entity_id,
                "conversation",
                {"should_expose": bool(should_expose)}
            )

            return self.json({"success": True})
        except Exception as err:
            _LOGGER.exception("Failed to update entity settings")
            return self.json({"error": str(err)}, status=500)


class RebuildView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/rebuild"
    name = "api:google_assistant_entity_console:rebuild"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            now = dt_util.now()
            date_str = now.strftime("%m%d%y")
            filename = f"gaGen_{date_str}.yaml"
            filepath = hass.config.path(filename)

            active_entities = await async_fetch_entities_data(hass)

            # Sort entities by floor, area, domain, entity_id
            sorted_entities = sorted(
                active_entities,
                key=lambda x: (x["floor"] or "TBA", x["area"] or "TBA", x["domain"], x["entity_id"])
            )

            entity_config = {}
            for entity in sorted_entities:
                if entity["should_expose"]:
                    cfg = {
                        "expose": True,
                        "name": entity["display_name"]
                    }
                    if entity["aliases"]:
                        cfg["aliases"] = entity["aliases"]
                    if entity["area"] and entity["area"] != "TBA":
                        cfg["room"] = entity["area"]
                    entity_config[entity["entity_id"]] = cfg

            ga_config = {
                "project_id": Secret("googleassistant_projectName"),
                "service_account": Include("homeassistantdocker-3f199-994a25247393.json"),
                "report_state": True,
                "secure_devices_pin": Secret("google_device_pin"),
                "expose_by_default": False,
                "entity_config": entity_config
            }

            # Generate YAML
            yaml_string = yaml.dump(ga_config, Dumper=yaml.SafeDumper, sort_keys=False, width=1000)

            # Post-process to remove quotes from !secret and !include
            cleaned_yaml = yaml_string
            cleaned_yaml = re.sub(r"!secret '([^']+)'", r"!secret \1", cleaned_yaml)
            cleaned_yaml = re.sub(r"!include '([^']+)'", r"!include \1", cleaned_yaml)

            # Syntax validation step
            class CustomLoader(yaml.SafeLoader):
                pass
            CustomLoader.add_constructor('!secret', lambda loader, node: node.value)
            CustomLoader.add_constructor('!include', lambda loader, node: node.value)

            try:
                yaml.load(cleaned_yaml, Loader=CustomLoader)
            except Exception as val_err:
                return self.json({"error": f"Generated YAML failed validation: {val_err}"}, status=500)

            # Write file
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(cleaned_yaml)

            # Dynamically update configuration.yaml
            config_path = hass.config.path("configuration.yaml")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    config_content = f.read()
                
                include_pattern = r"google_assistant:\s*!include\s*gaGen_\d{6}\.yaml"
                if re.search(include_pattern, config_content):
                    config_content = re.sub(
                        include_pattern,
                        f"google_assistant: !include {filename}",
                        config_content
                    )
                    with open(config_path, "w", encoding="utf-8") as f:
                        f.write(config_content)
                else:
                    _LOGGER.warning("Could not find google_assistant !include line in configuration.yaml")

            return self.json({
                "success": True,
                "exposed_count": len(entity_config),
                "yaml_written": filepath
            })
        except Exception as err:
            _LOGGER.exception("Failed to rebuild configs")
            return self.json({"error": str(err)}, status=500)


class RestartView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/restart"
    name = "api:google_assistant_entity_console:restart"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            await hass.services.async_call("homeassistant", "restart", blocking=False)
            return self.json({"success": True})
        except Exception as err:
            _LOGGER.exception("Failed to trigger Home Assistant restart")
            return self.json({"error": str(err)}, status=500)


class BlocklistView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/blocklist"
    name = "api:google_assistant_entity_console:blocklist"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            blocklist = load_blocklist(hass)
            return self.json({"blocklist": blocklist})
        except Exception as err:
            _LOGGER.exception("Failed to get blocklist")
            return self.json({"error": str(err)}, status=500)

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            blocklist = body.get("blocklist")
            if not isinstance(blocklist, list):
                return self.json({"error": "Blocklist must be a list"}, status=400)
            
            # Syntax validation for regexes
            for pattern in blocklist:
                try:
                    re.compile(pattern)
                except re.error as err:
                    return self.json({"error": f"Invalid regex pattern '{pattern}': {err}"}, status=400)

            save_blocklist(hass, blocklist)
            return self.json({"success": True, "blocklist": blocklist})
        except Exception as err:
            _LOGGER.exception("Failed to update blocklist")
            return self.json({"error": str(err)}, status=500)


class BlocklistAddView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/blocklist/add"
    name = "api:google_assistant_entity_console:blocklist:add"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            pattern = body.get("pattern")
            if not pattern:
                return self.json({"error": "Missing pattern"}, status=400)

            try:
                re.compile(pattern)
            except re.error as err:
                return self.json({"error": f"Invalid regex pattern: {err}"}, status=400)

            blocklist = load_blocklist(hass)
            if pattern not in blocklist:
                blocklist.append(pattern)
                save_blocklist(hass, blocklist)

            return self.json({"success": True, "blocklist": blocklist})
        except Exception as err:
            _LOGGER.exception("Failed to add to blocklist")
            return self.json({"error": str(err)}, status=500)


# AI Settings Storage Helpers
def load_ai_settings(hass: HomeAssistant) -> dict:
    filepath = hass.config.path("google_assistant_entity_console_ai_settings.json")
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception as err:
        _LOGGER.error("Failed to load AI settings: %s", err)
    return {}

def save_ai_settings(hass: HomeAssistant, settings: dict):
    filepath = hass.config.path("google_assistant_entity_console_ai_settings.json")
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except Exception as err:
        _LOGGER.error("Failed to save AI settings: %s", err)


# AI API Views
from homeassistant.helpers.aiohttp_client import async_get_clientsession

class AISettingsView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/ai/settings"
    name = "api:google_assistant_entity_console:ai:settings"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            settings = load_ai_settings(hass)
            return self.json({"settings": settings})
        except Exception as err:
            return self.json({"error": str(err)}, status=500)

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            settings = body.get("settings", {})
            if not isinstance(settings, dict):
                return self.json({"error": "Settings must be a dictionary"}, status=400)
            
            save_ai_settings(hass, settings)
            return self.json({"success": True, "settings": settings})
        except Exception as err:
            return self.json({"error": str(err)}, status=500)


class AIModelsView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/ai/models"
    name = "api:google_assistant_entity_console:ai:models"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            base_url = body.get("base_url", "").rstrip("/")
            api_key = body.get("api_key", "")
            
            if not base_url:
                return self.json({"error": "Missing base URL"}, status=400)
                
            session = async_get_clientsession(hass)
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
                
            async with session.get(f"{base_url}/models", headers=headers, timeout=10) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    return self.json({"error": f"Failed to fetch models (HTTP {resp.status}): {text}"}, status=resp.status)
                
                data = await resp.json()
                models = []
                if isinstance(data, dict) and "data" in data:
                    for item in data["data"]:
                        if isinstance(item, dict) and "id" in item:
                            models.append(item["id"])
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "id" in item:
                            models.append(item["id"])
                            
                return self.json({"models": sorted(models)})
        except Exception as err:
            _LOGGER.exception("Failed to query models")
            return self.json({"error": str(err)}, status=500)


class AIGenerateNicknamesView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/ai/generate_nicknames"
    name = "api:google_assistant_entity_console:ai:generate_nicknames"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            entities_to_gen = body.get("entities", [])
            if not entities_to_gen:
                return self.json({"error": "No entities provided"}, status=400)
                
            settings = load_ai_settings(hass)
            base_url = settings.get("base_url", "").rstrip("/")
            api_key = settings.get("api_key", "")
            model = settings.get("model", "")
            prompt_template = settings.get("nickname_prompt", "").strip()
            
            # Default fallback template
            if not prompt_template:
                prompt_template = (
                    "You are an assistant helping configure Google Assistant aliases for smart home entities.\n"
                    "For the following entity, generate 2-4 clean, natural-language nicknames (aliases) that a user would typically say to control the device.\n"
                    "Do NOT include markdown, explanations, bullet points, numbers, quotes, or punctuation.\n"
                    "Return the nicknames ONLY as a single comma-separated list on a single line.\n\n"
                    "Entity ID: {entity_id}\n"
                    "Friendly Name: {friendly_name}\n"
                    "Aliases:"
                )
                
            if not base_url or not model:
                return self.json({"error": "AI settings are incomplete. Please configure base URL and Model in Settings."}, status=400)
                
            session = async_get_clientsession(hass)
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
                
            results = {}
            for ent in entities_to_gen:
                ent_id = ent.get("entity_id")
                friendly = ent.get("display_name") or ent.get("name") or ent_id.split(".")[-1]
                
                # Render prompt
                prompt = prompt_template.format(entity_id=ent_id, friendly_name=friendly)
                
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 100
                }
                
                async with session.post(f"{base_url}/chat/completions", headers=headers, json=payload, timeout=15) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        content = data["choices"][0]["message"]["content"].strip()
                        # Clean content
                        aliases = [a.strip().strip('"').strip("'") for a in content.split(",") if a.strip()]
                        results[ent_id] = aliases
                    else:
                        text = await resp.text()
                        _LOGGER.error("LLM nickname request failed (HTTP %s): %s", resp.status, text)
                        
            return self.json({"results": results})
        except Exception as err:
            _LOGGER.exception("Failed to generate nicknames")
            return self.json({"error": str(err)}, status=500)


class AISuggestExposureView(HomeAssistantView):
    url = "/api/google_assistant_entity_console/ai/suggest_exposure"
    name = "api:google_assistant_entity_console:ai:suggest_exposure"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        try:
            body = await request.json()
            entity_list = body.get("entities", [])
            user_intent = body.get("user_intent", "")
            
            if not entity_list:
                return self.json({"error": "No entities provided"}, status=400)
            if not user_intent:
                return self.json({"error": "No user intent/criteria provided"}, status=400)
                
            settings = load_ai_settings(hass)
            base_url = settings.get("base_url", "").rstrip("/")
            api_key = settings.get("api_key", "")
            model = settings.get("model", "")
            prompt_template = settings.get("exposure_prompt", "").strip()
            
            # Default fallback template
            if not prompt_template:
                prompt_template = (
                    "You are an assistant helping configure which smart home entities to expose to Google Assistant.\n"
                    "Given a list of entities with their IDs, names, and domains, and the user's intent: '{user_intent}'.\n"
                    "Determine which entities from the list should be exposed.\n"
                    "Return ONLY a JSON list of entity IDs that should be exposed. Do not wrap in markdown codeblocks (e.g. ```json). Just return the raw JSON list.\n\n"
                    "Entities:\n"
                    "{entities_list}"
                )
                
            if not base_url or not model:
                return self.json({"error": "AI settings are incomplete. Please configure base URL and Model in Settings."}, status=400)
                
            session = async_get_clientsession(hass)
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
                
            # Serialize entities briefly for the prompt context
            serialized_ents = []
            for ent in entity_list:
                serialized_ents.append({
                    "entity_id": ent.get("entity_id"),
                    "name": ent.get("display_name") or ent.get("name"),
                    "domain": ent.get("domain")
                })
                
            entities_str = json.dumps(serialized_ents, indent=2)
            prompt = prompt_template.format(user_intent=user_intent, entities_list=entities_str)
            
            payload = {
                "model": model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1,
                "max_tokens": 1000
            }
            
            async with session.post(f"{base_url}/chat/completions", headers=headers, json=payload, timeout=25) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    
                    # Clean markdown formatting if returned
                    if content.startswith("```"):
                        content = re.sub(r"^```[a-zA-Z]*\n?", "", content)
                        content = re.sub(r"\n?```$", "", content)
                    content = content.strip()
                    
                    try:
                        exposed_ids = json.loads(content)
                        if isinstance(exposed_ids, list):
                            return self.json({"exposed_ids": exposed_ids})
                    except Exception as parse_err:
                        _LOGGER.error("Failed to parse LLM JSON exposure suggestions: %s (Raw: %s)", parse_err, content)
                        return self.json({"error": f"LLM returned invalid format: {content}"}, status=502)
                else:
                    text = await resp.text()
                    return self.json({"error": f"LLM exposure request failed (HTTP {resp.status}): {text}"}, status=resp.status)
                    
            return self.json({"error": "No response from LLM"}, status=502)
        except Exception as err:
            _LOGGER.exception("Failed to suggest exposure")
            return self.json({"error": str(err)}, status=500)
