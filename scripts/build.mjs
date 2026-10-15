import { mkdir, cp, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', 'favicon.svg', 'src'];
for (const name of files) await access(path.join(root, name));
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const name of files) await cp(path.join(root, name), path.join(root, 'dist', name), { recursive: true });
await writeFile(path.join(root, 'dist/config.local.js'), '// MQTT configuration is private to the dashboard gateway.\n');
try { await access(path.join(root, 'assets')); await cp(path.join(root, 'assets'), path.join(root, 'dist/assets'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.join(root, 'dist/vendor'), { recursive: true });
await cp(
  path.join(root, 'node_modules/mqtt/dist/mqtt.esm.js'),
  path.join(root, 'dist/vendor/mqtt.esm.js'),
);
console.log('Build selesai. File statis siap di folder dist/.');
