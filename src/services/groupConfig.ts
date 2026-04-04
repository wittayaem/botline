import pool from './db';

export type GroupStatus = 'pending' | 'approved' | 'rejected';

export interface GroupConfig {
  group_id: string;
  name: string;
  status: GroupStatus;
  enabled: boolean;
  save_text: boolean;
  save_images: boolean;
  save_files: boolean;
  download_password: string;
  ai_caption: boolean;
  ai_model: string;
  ai_chat: boolean;
  ai_equipment: boolean;
  reply_images: boolean;
  reply_files: boolean;
  welcome_enabled: boolean;
  welcome_text: string;
  welcome_image_url: string;
  expires_at?: string | null; // วันหมดอายุ (ISO string) หรือ null = ไม่มีกำหนด
  added_at?: string;
}

function toConfig(r: any): GroupConfig {
  return {
    group_id: r.group_id,
    name: r.name,
    status: r.status as GroupStatus,
    enabled: !!r.enabled,
    save_text: !!r.save_text,
    save_images: !!r.save_images,
    save_files: !!r.save_files,
    ai_caption: r.ai_caption === undefined ? true : !!r.ai_caption,
    ai_model: r.ai_model || '',
    download_password: r.download_password || '',
    ai_chat: r.ai_chat === undefined ? true : !!r.ai_chat,
    ai_equipment: r.ai_equipment === undefined ? true : !!r.ai_equipment,
    reply_images: r.reply_images === undefined ? true : !!r.reply_images,
    reply_files: r.reply_files === undefined ? true : !!r.reply_files,
    welcome_enabled: !!r.welcome_enabled,
    welcome_text: r.welcome_text || '',
    welcome_image_url: r.welcome_image_url || '',
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    added_at: r.added_at,
  };
}

export async function getGroup(groupId: string): Promise<GroupConfig | null> {
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM groups_config WHERE group_id = ?', [groupId]
  );
  if (!rows.length) return null;
  return toConfig(rows[0]);
}

// กลุ่มใหม่เริ่มต้นที่ status = 'pending'
export async function upsertGroup(groupId: string, name?: string): Promise<GroupConfig> {
  await pool.query(
    `INSERT INTO groups_config (group_id, name, status) VALUES (?, ?, 'pending')
     ON DUPLICATE KEY UPDATE group_id = group_id`,
    [groupId, name || 'ไม่ทราบชื่อ']
  );
  return (await getGroup(groupId))!;
}

export async function updateGroup(groupId: string, data: Partial<GroupConfig>) {
  const allowed = ['name', 'status', 'enabled', 'save_text', 'save_images', 'save_files', 'download_password', 'ai_caption', 'ai_model', 'ai_chat', 'ai_equipment', 'reply_images', 'reply_files', 'welcome_enabled', 'welcome_text', 'welcome_image_url', 'expires_at'];
  const keys = Object.keys(data).filter(k => allowed.includes(k));
  if (!keys.length) return;
  const fields = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => (data as any)[k]);
  await pool.query(
    `UPDATE groups_config SET ${fields} WHERE group_id = ?`,
    [...values, groupId]
  );
}

export async function getAllGroups(): Promise<GroupConfig[]> {
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM groups_config ORDER BY FIELD(status,"pending","approved","rejected"), added_at DESC'
  );
  return rows.map(toConfig);
}

export async function getPendingGroups(): Promise<GroupConfig[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT * FROM groups_config WHERE status = 'pending' ORDER BY added_at DESC"
  );
  return rows.map(toConfig);
}
