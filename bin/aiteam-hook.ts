import fs from 'fs';
import { constants } from 'fs';
import { getPipePath, isProjectAllowed, loadConfig } from '../src/config.js';

const event = process.argv[2];
if (!event) process.exit(0);

const input = await readStdin();
if (!input.trim()) process.exit(0);

let data: any;
try {
  data = JSON.parse(input);
} catch {
  process.exit(0);
}

const config = loadConfig();
if (!config.agents.claudeCode) process.exit(0);
if (!isProjectAllowed(data?.cwd || '', config)) process.exit(0);

const pipePath = getPipePath(config);
if (!fs.existsSync(pipePath)) process.exit(0);

const envelope = {
  ts: Date.now(),
  event,
  data,
};

try {
  const fd = fs.openSync(pipePath, constants.O_WRONLY | constants.O_NONBLOCK);
  fs.writeSync(fd, `${JSON.stringify(envelope)}\n`);
  fs.closeSync(fd);
} catch {
  // Never block or fail the host agent if the AiTeam daemon is not running.
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}
