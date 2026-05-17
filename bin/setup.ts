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
    'Run npm run start to launch collector and dashboard.',
    'Optional: run npm run install:claude-hooks if you want Claude Code collection.',
    'Optional: edit config projects only if you want to restrict monitored repositories.',
    'Keep privacy.storeRawPayload=false and privacy.storeToolOutput=false unless you explicitly need raw payload diagnostics.',
  ],
  config,
}, null, 2));
