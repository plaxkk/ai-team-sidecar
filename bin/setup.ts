import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureConfig, getDataDir, getHooksDir } from '../src/config.js';
import { getDb, closeDb } from '../src/collector/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { config, configPath, created } = ensureConfig();
const dataDir = getDataDir(config);
const hooksDir = getHooksDir(config);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(hooksDir, { recursive: true });
getDb();
closeDb();

// Handle --preset solo-founder flag
const args = process.argv.slice(2);
const presetIdx = args.indexOf('--preset');
const preset = presetIdx >= 0 ? args[presetIdx + 1] : null;

if (preset === 'solo-founder') {
  const templateDir = path.resolve(__dirname, '..', 'data', 'templates');
  const targetDir = process.cwd();
  const filesToCopy = [
    { src: 'CLAUDE.md', dest: 'CLAUDE.md' },
    { src: 'docs/ITERATION-PROCESS.md', dest: 'docs/ITERATION-PROCESS.md' },
    { src: 'docs/MVP-CHECKLIST.md', dest: 'docs/MVP-CHECKLIST.md' },
    { src: 'docs/QA-CHECKLIST.md', dest: 'docs/QA-CHECKLIST.md' },
    { src: 'docs/PMO-REVIEW-CADENCE.md', dest: 'docs/PMO-REVIEW-CADENCE.md' },
  ];

  const copied: string[] = [];
  const skipped: string[] = [];

  for (const { src, dest } of filesToCopy) {
    const srcPath = path.join(templateDir, src);
    const destPath = path.join(targetDir, dest);
    if (!fs.existsSync(srcPath)) {
      skipped.push(`${src} (template not found)`);
      continue;
    }
    if (fs.existsSync(destPath)) {
      skipped.push(`${dest} (already exists)`);
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copied.push(dest);
  }

  console.log(JSON.stringify({
    status: created ? 'created' : 'exists',
    config_path: configPath,
    data_dir: dataDir,
    hooks_dir: hooksDir,
    preset: 'solo-founder',
    preset_copied: copied,
    preset_skipped: skipped,
    dashboard_url: `http://localhost:${config.dashboardPort}`,
    next_steps: [
      'Run npm run start to launch collector and dashboard.',
      `Solo founder template files copied to ${targetDir}`,
      'Edit CLAUDE.md to customize for your project.',
      'Run npm run start to begin monitoring.',
    ],
    config,
  }, null, 2));
} else {
  console.log(JSON.stringify({
    status: created ? 'created' : 'exists',
    config_path: configPath,
    data_dir: dataDir,
    hooks_dir: hooksDir,
    dashboard_url: `http://localhost:${config.dashboardPort}`,
    next_steps: [
      'Run npm run start to launch collector and dashboard.',
      'Optional: run npm run install:claude-hooks if you want Claude Code collection.',
      'Optional: run npm run setup -- --preset solo-founder to generate a project template.',
      'Optional: edit config projects only if you want to restrict monitored repositories.',
      'Keep privacy.storeRawPayload=false and privacy.storeToolOutput=false unless you explicitly need raw payload diagnostics.',
    ],
    config,
  }, null, 2));
}
