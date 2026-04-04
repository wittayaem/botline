import pool from './db';

export async function getSetting(key: string): Promise<string> {
  const [rows] = await pool.query<any[]>('SELECT value FROM settings WHERE `key` = ?', [key]);
  return rows.length ? rows[0].value : '';
}

export async function setSetting(key: string, value: string) {
  await pool.query(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
    [key, value, value]
  );
}

export async function getWelcomeConfig() {
  const [rows] = await pool.query<any[]>(
    "SELECT `key`, `value` FROM settings WHERE `key` IN ('welcome_enabled','welcome_text','welcome_image_url')"
  );
  const cfg = { welcome_enabled: false, welcome_text: '', welcome_image_url: '' };
  for (const r of rows) {
    if (r.key === 'welcome_enabled')   cfg.welcome_enabled   = r.value === '1';
    if (r.key === 'welcome_text')      cfg.welcome_text      = r.value;
    if (r.key === 'welcome_image_url') cfg.welcome_image_url = r.value;
  }
  return cfg;
}
