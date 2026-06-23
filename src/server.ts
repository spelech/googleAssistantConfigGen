import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';
import ws from 'ws';
import { createConnection, createLongLivedTokenAuth, Connection } from 'home-assistant-js-websocket';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const HA_HOST = process.env.HA_HOST || '10.0.0.10';
const HA_PORT = process.env.HA_PORT || '8123';
const HA_TOKEN = process.env.HA_TOKEN || '';
const HA_URL = `http://${HA_HOST}:${HA_PORT}`;

app.use(express.json());

// Set up WebSocket global for Node.js
(global as any).WebSocket = ws;

let haConnection: Connection | null = null;

async function getHAConnection(): Promise<Connection> {
  if (haConnection && haConnection.connected) {
    return haConnection;
  }
  
  try {
    const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN);
    haConnection = await createConnection({ auth });
    console.log('Successfully connected to Home Assistant WebSocket API');
    return haConnection;
  } catch (error) {
    console.error('Failed to connect to Home Assistant WebSocket:', error);
    throw error;
  }
}

interface HAEntity {
  entity_id: string;
  device_id?: string;
  area_id?: string;
  name?: string;
  original_name?: string;
  aliases?: string[];
  options?: {
    conversation?: {
      should_expose?: boolean;
    };
  };
  platform?: string;
  device_class?: string;
  disabled_by?: string | null;
  hidden_by?: string | null;
}

interface HADevice {
  id: string;
  area_id?: string;
  name?: string;
  name_by_user?: string;
}

interface HAArea {
  id: string;
  name: string;
}

async function fetchRegistries() {
  const conn = await getHAConnection();
  
  const areas = await conn.sendMessagePromise<HAArea[]>({ type: 'config/area_registry/list' });
  const devices = await conn.sendMessagePromise<HADevice[]>({ type: 'config/device_registry/list' });
  const entities = await conn.sendMessagePromise<HAEntity[]>({ type: 'config/entity_registry/list' });
  
  const areaMap = new Map(areas.map(a => [a.id, a.name]));
  const deviceAreaMap = new Map(devices.map(d => [d.id, d.area_id]));
  const deviceNameMap = new Map(devices.map(d => [d.id, d.name_by_user || d.name]));
  
  const activeEntities = entities.filter(entity => !entity.disabled_by && !entity.hidden_by);
  
  return activeEntities.map(entity => {
    const entity_id = entity.entity_id;
    const device_id = entity.device_id;
    
    // Resolve Area
    let area_id = entity.area_id;
    if (!area_id && device_id) {
      area_id = deviceAreaMap.get(device_id);
    }
    const areaName = (area_id && areaMap.get(area_id)) || 'TBA';
    
    // Resolve Display Name
    let displayName = entity.name;
    if (!displayName && device_id) {
      displayName = deviceNameMap.get(device_id);
    }
    if (!displayName) {
      displayName = entity.original_name || entity_id.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';
    }
    
    const should_expose = entity.options?.conversation?.should_expose ?? false;
    const aliases = entity.aliases || [];
    const platform = entity.platform || '';
    const device_class = entity.device_class || '';
    const domain = entity_id.split('.')[0];
    
    return {
      entity_id,
      name: entity.name || null,
      original_name: entity.original_name || null,
      display_name: displayName,
      device_class,
      platform,
      should_expose,
      area: areaName,
      domain,
      aliases
    };
  });
}

app.get('/api/entities', async (req, res) => {
  try {
    const data = await fetchRegistries();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch entities' });
  }
});

app.post('/api/entities/update', async (req, res) => {
  const { entity_id, name, aliases, should_expose } = req.body;
  try {
    const conn = await getHAConnection();
    
    const payload = {
      type: 'config/entity_registry/update',
      entity_id,
      name: name || null,
      aliases: aliases || [],
      options: {
        conversation: {
          should_expose: should_expose ?? false
        }
      }
    };
    
    const result = await conn.sendMessagePromise(payload);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update entity' });
  }
});

// Custom classes to represent !secret and !include YAML tags in JS
class Secret {
  constructor(public value: string) {}
}
class Include {
  constructor(public value: string) {}
}

const secretType = new yaml.Type('!secret', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => new Secret(data),
  instanceOf: Secret,
  represent: (obj: any) => obj.value
});

const includeType = new yaml.Type('!include', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => new Include(data),
  instanceOf: Include,
  represent: (obj: any) => obj.value
});

const CUSTOM_SCHEMA = yaml.DEFAULT_SCHEMA.extend([secretType, includeType]);

app.post('/api/sync', async (req, res) => {
  const filepath = '/config/gaGen_112225.yaml';
  
  try {
    const entities = await fetchRegistries();
    
    // Sort entities first by area, then by domain
    const sorted = [...entities].sort((a, b) => {
      if (a.area !== b.area) return a.area.localeCompare(b.area);
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      return a.entity_id.localeCompare(b.entity_id);
    });
    
    const entityConfig: Record<string, any> = {};
    for (const entity of sorted) {
      if (entity.should_expose) {
        const cfg: any = {
          expose: true,
          name: entity.display_name
        };
        if (entity.aliases && entity.aliases.length > 0) {
          cfg.aliases = entity.aliases;
        }
        if (entity.area !== 'TBA') {
          cfg.room = entity.area;
        }
        entityConfig[entity.entity_id] = cfg;
      }
    }
    
    const gaConfig = {
      project_id: new Secret('googleassistant_projectName'),
      service_account: new Include('homeassistantdocker-3f199-994a25247393.json'),
      report_state: true,
      secure_devices_pin: new Secret('google_device_pin'),
      expose_by_default: false,
      entity_config: entityConfig
    };
    
    // Write Yaml with tags
    const yamlString = yaml.dump(gaConfig, {
      schema: CUSTOM_SCHEMA,
      lineWidth: 1000,
      noRefs: true,
      sortKeys: false
    });
    
    // Post-process to remove quotes from !secret and !include
    let cleanedYaml = yamlString;
    cleanedYaml = cleanedYaml.replace(/!secret '([^']+)'/g, '!secret $1');
    cleanedYaml = cleanedYaml.replace(/!include '([^']+)'/g, '!include $1');
    
    // Ensure dir exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, cleanedYaml, 'utf8');
    
    // Request Sync in HA
    try {
      await axios.post(
        `${HA_URL}/api/services/google_assistant/request_sync`,
        {},
        {
          headers: {
            Authorization: `Bearer ${HA_TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
    } catch (err: any) {
      console.error('Failed to trigger HA request_sync service:', err.message);
    }
    
    res.json({
      success: true,
      exposed_count: Object.keys(entityConfig).length,
      yaml_written: filepath
    });
  } catch (error: any) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message || 'Failed to sync configs' });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../static')));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
