import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// A private writable data directory keeps the application mount read-only.
export async function createAccountStore(filename, seedFilename) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  async function save(accounts) {
    const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  let accounts;
  try { accounts = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || !seedFilename) throw error;
    accounts = JSON.parse(await readFile(seedFilename, 'utf8'));
    await save(accounts);
  }
  if (!Array.isArray(accounts) || !accounts.length
    || new Set(accounts.map(item => item.id)).size !== accounts.length
    || accounts.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string'
      || !/^[a-f0-9]{32}$/.test(item.salt) || !/^[a-f0-9]{128}$/.test(item.hash))) {
    throw new Error('Invalid private account store');
  }
  return { accounts, save };
}
