import fs from 'fs';
import path from 'path';
import { ensureConfig, getDataDir, getHooksDir } from '../src/config.js';
import { getDb, closeDb } from '../src/collector/db.js';

const { config, configPath, created } = ensureConfig();
const dataDir = getDataDir(config);
const hooksDir = getHooksDir(config);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(hooksDir, { recursive: true });
getDb();
closeDb();

console.log(JSON.stringify({
  status: created ? 'created' : 'exists',
  config_path: configPath,
  data_dir: dataDir,
  hooks_dir: hooksDir,
  dashboard_url: `http://localhost:${config.dashboardPort}`,
  next_steps: [
    'Edit config projects if you want to restrict monitored repositories.',
    'Run npm run install:claude-hooks to generate Claude Code hook scripts.',
    'Run npm run start to launch collector and dashboard.',
  ],
  config,
}, null, 2));
