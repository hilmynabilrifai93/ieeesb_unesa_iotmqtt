import { mqttConfig } from '../config.local.js';
import { hashPassword } from '../server/app.mjs';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const accounts = [], rows = [];
for (let i=0; i<mqttConfig.devices.length; i++) {
  const device = mqttConfig.devices[i];
  const password = randomBytes(12).toString('base64url');
  accounts.push({...device, ...await hashPassword(password)});
  rows.push(`| ${device.name} | \`${device.id}\` | \`ieee/lab/${device.id}\` | \`${password}\` |`);
}
await writeFile('server/accounts.json', JSON.stringify(accounts,null,2)+'\n');
await writeFile('Dashboard - Topic dan Password.md', '# Login Dashboard HINT IoT\n\nURL: https://ieee.hint-lab.id/\n\nPilih perangkat lalu masukkan password berikut. Satu login hanya dapat mengakses perangkat tersebut. Klik Keluar untuk berganti perangkat.\n\n| Perangkat | Device ID | Topic dasar | Password dashboard |\n|---|---|---|---|\n'+rows.join('\n')+'\n\nTopic dasar mempunyai suffix `/telemetry`, `/state`, `/status`, dan `/command`. Password di atas khusus login dashboard, bukan password MQTT firmware ESP32. Simpan dokumen ini secara pribadi.\n');
console.log(`Created ${accounts.length} hashed accounts and private Markdown mapping.`);
