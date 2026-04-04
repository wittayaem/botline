import pool from './db';

export interface GroupOperator {
  id: number;
  group_id: string;
  line_user_id: string;
  display_name: string;
  can_manage: boolean;
  added_at: string;
}

export async function getOperators(groupId: string): Promise<GroupOperator[]> {
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM group_operators WHERE group_id = ? ORDER BY added_at',
    [groupId]
  );
  return rows.map(r => ({ ...r, can_manage: !!r.can_manage }));
}

export async function isOperator(groupId: string, lineUserId: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    'SELECT id FROM group_operators WHERE group_id = ? AND line_user_id = ?',
    [groupId, lineUserId]
  );
  return rows.length > 0;
}

export async function canManageOperators(groupId: string, lineUserId: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    'SELECT can_manage FROM group_operators WHERE group_id = ? AND line_user_id = ?',
    [groupId, lineUserId]
  );
  return rows.length > 0 && !!rows[0].can_manage;
}

export async function addOperator(groupId: string, lineUserId: string, displayName: string, canManage = false) {
  await pool.query(
    `INSERT INTO group_operators (group_id, line_user_id, display_name, can_manage)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
    [groupId, lineUserId, displayName, canManage ? 1 : 0]
  );
}

export async function removeOperator(groupId: string, lineUserId: string) {
  await pool.query(
    'DELETE FROM group_operators WHERE group_id = ? AND line_user_id = ?',
    [groupId, lineUserId]
  );
}
