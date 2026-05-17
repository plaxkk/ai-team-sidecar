import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { getConfigPath, getDataDir, loadConfig } from '../src/config.js';

type Check = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

const config = loadConfig();
const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = getDataDir(config);
const checks: Check[] = [];

checks.push({
  name: 'config',
  status: fs.existsSync(getConfigPath()) ? 'pass' : 'warn',
  message: fs.existsSync(getConfigPath())
    ? `Config found: ${getConfigPath()}`
    : `Config not found yet. Run npm run setup to create ${getConfigPath()}`,
});

checks.push({
  name: 'data-dir',
  status: fs.existsSync(dataDir) ? 'pass' : 'warn',
  message: fs.existsSync(dataDir)
    ? `Local data directory exists: ${dataDir}`
    : `Local data directory does not exist yet: ${dataDir}`,
});

checks.push({
  name: 'privacy-defaults',
  status: config.privacy.storeRawPayload || config.privacy.storeToolOutput ? 'warn' : 'pass',
  message: config.privacy.storeRawPayload || config.privacy.storeToolOutput
    ? 'Raw payload or tool output storage is enabled. Keep local data out of git.'
    : 'Raw payload and tool output storage are disabled.',
});

checks.push({
  name: 'project-scope',
  status: config.projects.length > 0 ? 'pass' : 'warn',
  message: config.projects.length > 0
    ? `Monitoring ${config.projects.length} configured project(s).`
    : 'No project filter configured. Sidecar will accept every cwd it sees.',
});

const tracked = trackedFiles();
const trackedSensitive = tracked.filter(isSensitiveTrackedFile);
checks.push({
  name: 'tracked-private-data',
  status: trackedSensitive.length === 0 ? 'pass' : 'fail',
  message: trackedSensitive.length === 0
    ? 'No tracked SQLite, JSONL, env, or local data files detected.'
    : `Tracked private data candidates: ${trackedSensitive.join(', ')}`,
});

const personalPathHits = tracked.flatMap(file => personalPathHitsInFile(file));
checks.push({
  name: 'tracked-personal-paths',
  status: personalPathHits.length === 0 ? 'pass' : 'warn',
  message: personalPathHits.length === 0
    ? 'No tracked absolute home-path references detected.'
    : `Tracked files mention local home paths: ${personalPathHits.slice(0, 8).join(', ')}`,
});

const localDataFiles = findLocalDataFiles(repoRoot);
checks.push({
  name: 'ignored-local-data',
  status: localDataFiles.length === 0 ? 'pass' : 'warn',
  message: localDataFiles.length === 0
    ? 'No local data files found inside the repo.'
    : `Local data files exist but should remain ignored: ${localDataFiles.slice(0, 8).join(', ')}`,
});

for (const check of checks) {
  const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${icon}] ${check.name}: ${check.message}`);
}

if (checks.some(check => check.status === 'fail')) {
  process.exit(1);
}

function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isSensitiveTrackedFile(file: string): boolean {
  return /(^|\/)(data|local|private|transcripts)\//.test(file)
    || /\.(db|db-wal|db-shm|sqlite|sqlite3|jsonl)$/i.test(file)
    || /^\.env(\.|$)/.test(file)
    || /(^|\/)(\.claude|\.codex|\.ai-team-sidecar)\//.test(file);
}

function personalPathHitsInFile(file: string): string[] {
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 500_000) return [];

  const text = fs.readFileSync(absolute, 'utf8');
  const home = os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(home, 'g'),
    /\/Users\/[A-Za-z0-9._-]+\/repos\/[A-Za-z0-9._-]+/g,
  ];

  return patterns.flatMap(pattern => {
    const matches = text.match(pattern) || [];
    return matches.length > 0 ? [`${file}`] : [];
  });
}

function findLocalDataFiles(root: string): string[] {
  const candidates = ['data', 'dist/data', '.ai-team-sidecar', 'local', 'private', 'transcripts'];
  const results: string[] = [];

  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    if (!fs.existsSync(fullPath)) continue;
    collect(fullPath, results);
  }

  return results.map(file => path.relative(root, file));
}

function collect(current: string, results: string[]) {
  const stat = fs.statSync(current);
  if (stat.isFile()) {
    if (/\.(db|db-wal|db-shm|sqlite|sqlite3|jsonl)$/i.test(current) || path.basename(current) === 'feedback-pipe') {
      results.push(current);
    }
    return;
  }

  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(current)) {
    collect(path.join(current, entry), results);
  }
}
