import mqtt from 'mqtt';
import { fileURLToPath } from 'node:url';
import { createAccountStore } from './account-store.mjs';
import { mqttConfig } from '../config.local.js';
import { createAuthServer } from './app.mjs';
const store = await createAccountStore(
  process.env.ACCOUNTS_FILE || fileURLToPath(new URL('../data/accounts.json', import.meta.url)),
  fileURLToPath(new URL('./accounts.json', import.meta.url)),
);
const accounts = store.accounts;
const broker = mqtt.connect(mqttConfig.url, {
  username: mqttConfig.username, password: mqttConfig.password,
  clientId: `hint_dashboard_gateway_${process.pid}`, clean: true, reconnectPeriod: 2000,
});
broker.on('connect', () => {
  broker.subscribe(accounts.flatMap(({ id }) => ['telemetry', 'state', 'status'].map(channel => `ieee/lab/${id}/${channel}`)), { qos: 0 });
  console.log('Dashboard gateway: MQTT connected');
});
broker.on('error', () => console.error('Dashboard gateway: MQTT connection error'));
const server = createAuthServer({ accounts, persistAccounts: store.save, broker, origin: process.env.DASHBOARD_ORIGIN || 'https://ieee.hint-lab.id', secureCookie: process.env.COOKIE_SECURE !== 'false' });
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Dashboard login API ready'));
process.on('SIGTERM', () => { broker.end(true); server.close(() => process.exit(0)); });
