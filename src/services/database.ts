import pool from './db';

export interface MessageRecord {
  message_id: string;
  group_id: string;
  sender_id: string;
  type: string;
  text?: string;
  file_name?: string;
  file_size?: number;
  file_path?: string;
  timestamp: number;
  caption?: string;
}

export async function saveMessage(record: MessageRecord) {
  await pool.query(
    `INSERT IGNORE INTO messages
      (message_id, group_id, sender_id, type, text, file_name, file_size, file_path, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.message_id, record.group_id, record.sender_id,
      record.type, record.text ?? null, record.file_name ?? null,
      record.file_size ?? null, record.file_path ?? null, record.timestamp,
    ]
  );
}

export async function updateCaption(messageId: string, caption: string) {
  await pool.query('UPDATE messages SET caption = ? WHERE message_id = ?', [caption, messageId]);
}

export async function getMessagesByGroup(groupId: string, limit = 100) {
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
    [groupId, limit]
  );
  return rows;
}

export async function searchImages(groupId: string, keyword: string, year?: number, month?: number) {
  const like = `%${keyword}%`;
  let dateCond = '';
  const params: any[] = [groupId, like, like];

  if (year && month) {
    dateCond = `AND YEAR(created_at) = ? AND MONTH(created_at) = ?`;
    params.push(year, month);
  } else if (year) {
    dateCond = `AND YEAR(created_at) = ?`;
    params.push(year);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM messages
     WHERE group_id = ? AND type = 'image'
       AND (caption LIKE ? OR file_path LIKE ?)
       ${dateCond}
     ORDER BY created_at DESC
     LIMIT 50`,
    params
  );
  return rows;
}

// ดึงรูปที่ยังไม่มี caption ในช่วงเวลาที่กำหนด เพื่อ re-analyze
export async function getUncaptionedImages(groupId: string, year: number, month?: number) {
  let dateCond = `AND YEAR(created_at) = ?`;
  const params: any[] = [groupId, year];

  if (month) {
    dateCond += ` AND MONTH(created_at) = ?`;
    params.push(month);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM messages
     WHERE group_id = ? AND type = 'image' AND (caption IS NULL OR caption = '')
     ${dateCond}
     ORDER BY created_at DESC
     LIMIT 20`,
    params
  );
  return rows;
}

export async function filterImages(groupId: string, keyword?: string, fromDate?: string, toDate?: string, limit = 200) {
  let where = `group_id = ? AND type = 'image'`;
  const params: any[] = [groupId];
  if (keyword) {
    where += ` AND (caption LIKE ? OR file_path LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (fromDate) { where += ` AND DATE(FROM_UNIXTIME(timestamp/1000)) >= ?`; params.push(fromDate); }
  if (toDate)   { where += ` AND DATE(FROM_UNIXTIME(timestamp/1000)) <= ?`; params.push(toDate); }
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return rows;
}

export async function filterFiles(groupId: string, keyword?: string, fromDate?: string, toDate?: string, limit = 200) {
  let where = `group_id = ? AND type = 'file'`;
  const params: any[] = [groupId];
  if (keyword) {
    where += ` AND (file_name LIKE ? OR caption LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (fromDate) { where += ` AND DATE(FROM_UNIXTIME(timestamp/1000)) >= ?`; params.push(fromDate); }
  if (toDate)   { where += ` AND DATE(FROM_UNIXTIME(timestamp/1000)) <= ?`; params.push(toDate); }
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return rows;
}

export async function countByGroup(groupId: string) {
  const [rows] = await pool.query<any[]>(
    `SELECT type, COUNT(*) as count FROM messages WHERE group_id = ? GROUP BY type`,
    [groupId]
  );
  return rows;
}
