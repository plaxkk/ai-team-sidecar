import { loadConfig } from '../src/config.js';

const config = loadConfig();
const port = Number(process.env.PORT) || config.dashboardPort;

console.log(`http://localhost:${port}`);
