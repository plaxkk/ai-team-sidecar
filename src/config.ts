import fs from 'fs';
import os from 'os';
import path from 'path';

export interface SidecarProjectConfig {
  name?: string;
  path: string;
}

export interface SidecarConfig {
  dataDir: string;
  dashboardPort: number;
  projects: SidecarProjectConfig[];
  agents: {
    claudeCode: boolean;
    codexCli: boolean;
  };
  privacy: {
    storeRawPayload: boolean;
    storeToolOutput: boolean;
  };
}

export const SIDECAR_HOME = path.join(os.homedir(), '.ai-team-sidecar');
export const DEFAULT_CONFIG_PATH = path.join(SIDECAR_HOME, 'config.json');

const DEFAULT_CONFIG: SidecarConfig = {
  dataDir: path.join(SIDECAR_HOME, 'data'),
  dashboardPort: 4041,
  projects: [],
  agents: {
    claudeCode: true,
    codexCli: true,
  },
  privacy: {
    storeRawPayload: true,
    storeToolOutput: true,
  },
};

export function loadConfig(): SidecarConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return DEFAULT_CONFIG;

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<SidecarConfig>;
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...raw,
    agents: { ...DEFAULT_CONFIG.agents, ...(raw.agents || {}) },
    privacy: { ...DEFAULT_CONFIG.privacy, ...(raw.privacy || {}) },
  });
}

export function ensureConfig(): { config: SidecarConfig; configPath: string; created: boolean } {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  if (fs.existsSync(configPath)) {
    return { config: loadConfig(), configPath, created: false };
  }

  const config = normalizeConfig(DEFAULT_CONFIG);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { config, configPath, created: true };
}

export function getConfigPath(): string {
  return expandHome(process.env.SIDECAR_CONFIG || DEFAULT_CONFIG_PATH);
}

export function getDataDir(config = loadConfig()): string {
  return expandHome(process.env.DATA_DIR || config.dataDir);
}

export function getPipePath(config = loadConfig()): string {
  return path.join(getDataDir(config), 'feedback-pipe');
}

export function getHooksDir(config = loadConfig()): string {
  return path.join(path.dirname(getDataDir(config)), 'hooks');
}

export function isProjectAllowed(cwd: string, config = loadConfig()): boolean {
  const normalizedCwd = normalizePath(cwd);
  if (!normalizedCwd) return false;
  if (config.projects.length === 0) return true;
  return config.projects.some(project => {
    const projectPath = normalizePath(project.path);
    return normalizedCwd === projectPath || normalizedCwd.startsWith(`${projectPath}${path.sep}`);
  });
}

export function expandHome(value: string): string {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function normalizePath(value: string): string {
  if (!value) return '';
  return path.resolve(expandHome(value));
}

function normalizeConfig(config: SidecarConfig): SidecarConfig {
  return {
    ...config,
    dataDir: expandHome(config.dataDir),
    dashboardPort: Number(config.dashboardPort || DEFAULT_CONFIG.dashboardPort),
    projects: (config.projects || [])
      .filter(project => project && project.path)
      .map(project => ({
        ...project,
        path: normalizePath(project.path),
      })),
  };
}
