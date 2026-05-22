import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AiTeamProjectConfig {
  name?: string;
  path: string;
}

export interface AiTeamConfig {
  dataDir: string;
  dashboardPort: number;
  /** Parent directory containing all user projects. Auto-detect on first setup. */
  projectsDir: string;
  /** Explicit project list. When set, overrides projectsDir for fine-grained control. */
  projects: AiTeamProjectConfig[];
  preset?: 'solo-founder';
  agents: {
    claudeCode: boolean;
    codexCli: boolean;
  };
  privacy: {
    storeRawPayload: boolean;
    storeToolOutput: boolean;
  };
}

export const AITEAM_HOME = path.join(os.homedir(), '.aiteam');
export const DEFAULT_CONFIG_PATH = path.join(AITEAM_HOME, 'config.json');

const DEFAULT_CONFIG: AiTeamConfig = {
  dataDir: path.join(AITEAM_HOME, 'data'),
  dashboardPort: 4041,
  projectsDir: '',
  projects: [],
  agents: {
    claudeCode: true,
    codexCli: true,
  },
  privacy: {
    storeRawPayload: false,
    storeToolOutput: false,
  },
};

export function loadConfig(): AiTeamConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return DEFAULT_CONFIG;

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AiTeamConfig>;
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...raw,
    agents: { ...DEFAULT_CONFIG.agents, ...(raw.agents || {}) },
    privacy: { ...DEFAULT_CONFIG.privacy, ...(raw.privacy || {}) },
  });
}

export function ensureConfig(): { config: AiTeamConfig; configPath: string; created: boolean } {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  if (fs.existsSync(configPath)) {
    return { config: loadConfig(), configPath, created: false };
  }

  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    projectsDir: detectProjectsDir(),
  });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { config, configPath, created: true };
}

/**
 * Auto-detect the user's projects directory by checking common conventions.
 * Returns the first existing directory, or empty string if none found.
 */
export function detectProjectsDir(): string {
  const home = os.homedir();
  const candidates = ['repos', 'projects', 'code', 'dev', 'src', 'workspace'];
  for (const candidate of candidates) {
    const fullPath = path.join(home, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      return fullPath;
    }
  }
  return '';
}

export function getConfigPath(): string {
  return expandHome(process.env.AITEAM_CONFIG || DEFAULT_CONFIG_PATH);
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

  // Explicit projects list takes priority
  if (config.projects.length > 0) {
    return config.projects.some(project => {
      const projectPath = normalizePath(project.path);
      return normalizedCwd === projectPath || normalizedCwd.startsWith(`${projectPath}${path.sep}`);
    });
  }

  // Use projectsDir as a parent directory filter
  if (config.projectsDir) {
    const dir = normalizePath(config.projectsDir);
    return normalizedCwd === dir || normalizedCwd.startsWith(`${dir}${path.sep}`);
  }

  // No filter configured — accept all
  return true;
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

function normalizeConfig(config: AiTeamConfig): AiTeamConfig {
  return {
    ...config,
    dataDir: expandHome(config.dataDir),
    dashboardPort: Number(config.dashboardPort || DEFAULT_CONFIG.dashboardPort),
    projectsDir: config.projectsDir ? expandHome(config.projectsDir) : '',
    projects: (config.projects || [])
      .filter(project => project && project.path)
      .map(project => ({
        ...project,
        path: normalizePath(project.path),
      })),
  };
}
