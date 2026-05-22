import fs from 'fs';
import path from 'path';
import { ensureConfig, getHooksDir } from '../src/config.js';

const { config, configPath } = ensureConfig();
const hooksDir = getHooksDir(config);
fs.mkdirSync(hooksDir, { recursive: true });

const repoRoot = path.resolve(import.meta.dirname, '..');
const hookMap: Record<string, string> = {
  'on-session.sh': 'SessionStart',
  'on-user-prompt.sh': 'UserPromptSubmit',
  'on-post-tool.sh': 'PostToolUse',
  'on-stop.sh': 'Stop',
};

for (const [fileName, eventName] of Object.entries(hookMap)) {
  const filePath = path.join(hooksDir, fileName);
  const script = `#!/usr/bin/env bash
set -euo pipefail
ROOT="${repoRoot}"
node --loader ts-node/esm "$ROOT/bin/aiteam-hook.ts" "${eventName}"
`;
  fs.writeFileSync(filePath, script, { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

const settingsSnippet = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: path.join(hooksDir, 'on-session.sh') }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: path.join(hooksDir, 'on-user-prompt.sh') }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: path.join(hooksDir, 'on-post-tool.sh') }] }],
    Stop: [{ hooks: [{ type: 'command', command: path.join(hooksDir, 'on-stop.sh') }] }],
  },
};

console.log(JSON.stringify({
  status: 'installed',
  config_path: configPath,
  hooks_dir: hooksDir,
  scripts: Object.keys(hookMap).map(file => path.join(hooksDir, file)),
  claude_code_settings_snippet: settingsSnippet,
}, null, 2));
