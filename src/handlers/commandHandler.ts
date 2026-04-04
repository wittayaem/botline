import { PostbackEvent } from '@line/bot-sdk';
import { client } from '../services/lineClient';
import { getGroup, updateGroup } from '../services/groupConfig';
import { isOperator, canManageOperators, addOperator, removeOperator, getOperators } from '../services/operators';
import logger from '../utils/logger';

// pending "เพิ่มผู้ดูแล" mode: groupId → { expiresAt, triggeredBy }
const pendingAdd = new Map<string, { expiresAt: number; triggeredBy: string }>();

export function isPendingAddOperator(groupId: string): boolean {
  const p = pendingAdd.get(groupId);
  if (!p) return false;
  if (Date.now() > p.expiresAt) { pendingAdd.delete(groupId); return false; }
  return true;
}

export function getPendingAddTrigger(groupId: string): string {
  return pendingAdd.get(groupId)?.triggeredBy ?? '';
}

export function clearPendingAddOperator(groupId: string) {
  pendingAdd.delete(groupId);
}

export async function handlePendingAddOperator(groupId: string, senderId: string, displayName: string) {
  clearPendingAddOperator(groupId);
  await addOperator(groupId, senderId, displayName, false);
  try {
    await client.pushMessage({ to: groupId, messages: [{
      type: 'text',
      text: `✅ เพิ่ม ${displayName || senderId} เป็นผู้ดูแลกลุ่มนี้แล้ว`,
    }]});
  } catch {}
}

/** returns true if the message was a command and was handled */
export async function handleCommand(
  text: string,
  replyToken: string,
  groupId: string,
  senderId: string,
): Promise<boolean> {
  const t = text.trim();

  const op = await isOperator(groupId, senderId);
  if (!op) return false;

  // "ตั้งค่า" — show settings card
  if (t === 'ตั้งค่า') {
    const config = await getGroup(groupId);
    if (!config) return false;
    try {
      await client.replyMessage({ replyToken, messages: [buildSettingsMessage(config)] });
    } catch {}
    return true;
  }

  // "ตั้งค่า [field] [value]"
  const cmdMatch = t.match(/^ตั้งค่า\s+(.+)/);
  if (cmdMatch) {
    return await handleTextCommand(cmdMatch[1].trim(), replyToken, groupId);
  }

  // "เพิ่มผู้ดูแล"
  if (t === 'เพิ่มผู้ดูแล') {
    const canManage = await canManageOperators(groupId, senderId);
    if (!canManage) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '⚠️ คุณไม่มีสิทธิ์เพิ่มผู้ดูแล' }] });
      return true;
    }
    pendingAdd.set(groupId, { expiresAt: Date.now() + 60_000, triggeredBy: senderId });
    await client.replyMessage({ replyToken, messages: [{
      type: 'text',
      text: '⏳ รอ 60 วินาที\nให้คนที่ต้องการเพิ่มสิทธิ์ส่งข้อความมาได้เลยครับ',
    }]});
    return true;
  }

  // "รายชื่อผู้ดูแล"
  if (t === 'รายชื่อผู้ดูแล') {
    const ops = await getOperators(groupId);
    if (ops.length === 0) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '📋 ยังไม่มีผู้ดูแลกลุ่มนี้' }] });
    } else {
      const list = ops.map((o, i) => `${i + 1}. ${o.display_name || o.line_user_id}${o.can_manage ? ' 👑' : ''}`).join('\n');
      await client.replyMessage({ replyToken, messages: [{
        type: 'text',
        text: `👥 ผู้ดูแลกลุ่มนี้:\n${list}\n\n👑 = มีสิทธิ์เพิ่ม/ลบผู้ดูแล`,
      }]});
    }
    return true;
  }

  // "ลบผู้ดูแล"
  if (t === 'ลบผู้ดูแล') {
    const canManage = await canManageOperators(groupId, senderId);
    if (!canManage) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '⚠️ คุณไม่มีสิทธิ์ลบผู้ดูแล' }] });
      return true;
    }
    const ops = await getOperators(groupId);
    const others = ops.filter(o => o.line_user_id !== senderId);
    if (others.length === 0) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '📋 ไม่มีผู้ดูแลอื่นให้ลบ' }] });
      return true;
    }
    const list = others.map((o, i) => `${i + 1}. ${o.display_name || o.line_user_id}`).join('\n');
    await client.replyMessage({ replyToken, messages: [{
      type: 'text',
      text: `👥 เลือกผู้ดูแลที่ต้องการลบ:\n${list}\n\nพิมพ์: ลบผู้ดูแล [ลำดับ หรือ ชื่อ]`,
    }]});
    return true;
  }

  // "ลบผู้ดูแล [target]"
  const delMatch = t.match(/^ลบผู้ดูแล\s+(.+)/);
  if (delMatch) {
    const canManage = await canManageOperators(groupId, senderId);
    if (!canManage) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '⚠️ คุณไม่มีสิทธิ์ลบผู้ดูแล' }] });
      return true;
    }
    const ops = await getOperators(groupId);
    const others = ops.filter(o => o.line_user_id !== senderId);
    const target = delMatch[1].trim();
    const num = parseInt(target);
    const found = isNaN(num)
      ? others.find(o => o.display_name === target || o.line_user_id === target)
      : others[num - 1];
    if (!found) {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '❌ ไม่พบผู้ดูแลที่ระบุ' }] });
      return true;
    }
    await removeOperator(groupId, found.line_user_id);
    await client.replyMessage({ replyToken, messages: [{
      type: 'text',
      text: `✅ ลบ ${found.display_name || found.line_user_id} ออกจากผู้ดูแลแล้ว`,
    }]});
    return true;
  }

  return false;
}

async function handleTextCommand(args: string, replyToken: string, groupId: string): Promise<boolean> {
  const parts = args.split(/\s+/);
  const field = parts[0];
  const value = parts.slice(1).join(' ');

  const config = await getGroup(groupId);
  if (!config) return false;

  const isOn = (v: string) => v === 'เปิด' || v === 'on' || v === '1';

  const fieldMap: Record<string, string> = {
    'บอท': 'enabled', 'bot': 'enabled',
    'ข้อความ': 'save_text', 'text': 'save_text',
    'รูป': 'save_images', 'รูปภาพ': 'save_images', 'image': 'save_images',
    'ไฟล์': 'save_files', 'file': 'save_files',
    'ลิงก์รูป': 'reply_images',
    'ลิงก์ไฟล์': 'reply_files',
  };

  const dbField = fieldMap[field];
  if (dbField) {
    if (!value) {
      await client.replyMessage({ replyToken, messages: [{
        type: 'text', text: `❓ ระบุ เปิด หรือ ปิด ด้วยครับ\nเช่น: ตั้งค่า ${field} เปิด`,
      }]});
      return true;
    }
    const newVal = isOn(value);
    await updateGroup(groupId, { [dbField]: newVal } as any);
    await client.replyMessage({ replyToken, messages: [{
      type: 'text', text: `${newVal ? '✅' : '❌'} ${field}: ${newVal ? 'เปิด' : 'ปิด'}แล้ว`,
    }]});
    return true;
  }

  if (field === 'รหัส' || field === 'password') {
    if (!value || value === 'ยกเลิก' || value === 'ลบ') {
      await updateGroup(groupId, { download_password: '' } as any);
      await client.replyMessage({ replyToken, messages: [{
        type: 'text', text: '🔓 ยกเลิกรหัสผ่านแล้ว\nดาวน์โหลดได้เลยโดยไม่ต้องใส่รหัส',
      }]});
    } else {
      await updateGroup(groupId, { download_password: value } as any);
      await client.replyMessage({ replyToken, messages: [{
        type: 'text', text: `🔒 ตั้งรหัสดาวน์โหลดแล้ว\nรหัส: ${value}`,
      }]});
    }
    return true;
  }

  return false;
}

export async function handlePostback(event: PostbackEvent) {
  if (event.source.type !== 'group') return;
  const groupId = event.source.groupId;
  const senderId = event.source.userId || '';

  const op = await isOperator(groupId, senderId);
  if (!op) return;

  // format: "toggle|groupId|field|newValue"
  const parts = event.postback.data.split('|');
  if (parts[0] !== 'toggle' || parts.length < 4) return;
  const [, pgId, field, newValueStr] = parts;
  if (pgId !== groupId) return;

  const newValue = newValueStr === 'true';
  const config = await getGroup(groupId);
  if (!config) return;

  await updateGroup(groupId, { [field]: newValue } as any);
  const updated = { ...config, [field]: newValue };

  try {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [buildSettingsMessage(updated as any)],
    });
  } catch {}
}

export function buildSettingsMessage(config: any): any {
  const gid = config.group_id;
  const hasPassword = !!config.download_password;

  function row(label: string, field: string, current: boolean) {
    return {
      type: 'box',
      layout: 'horizontal',
      alignItems: 'center',
      paddingTop: '6px',
      paddingBottom: '6px',
      contents: [
        { type: 'text', text: label, flex: 3, size: 'sm' },
        {
          type: 'button',
          action: {
            type: 'postback',
            label: current ? '✅ เปิด' : '❌ ปิด',
            data: `toggle|${gid}|${field}|${!current}`,
          },
          style: current ? 'primary' : 'secondary',
          height: 'sm',
          flex: 2,
          color: current ? '#06c755' : '#aaaaaa',
        },
      ],
    };
  }

  return {
    type: 'flex',
    altText: `⚙️ ตั้งค่ากลุ่ม ${config.name}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06c755',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '⚙️ ตั้งค่ากลุ่ม', color: '#ffffff', size: 'xs' },
          { type: 'text', text: config.name, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'none',
        contents: [
          { type: 'text', text: 'กดปุ่มเพื่อสลับ เปิด/ปิด', size: 'xs', color: '#888888' },
          { type: 'separator', margin: 'sm' },
          row('🤖 บอท', 'enabled', config.enabled),
          row('💬 ข้อความ', 'save_text', config.save_text),
          row('📸 รูปภาพ', 'save_images', config.save_images),
          row('📁 ไฟล์', 'save_files', config.save_files),
          row('🔗 ลิงก์รูป', 'reply_images', config.reply_images !== false),
          row('🔗 ลิงก์ไฟล์', 'reply_files', config.reply_files !== false),
          {
            type: 'box', layout: 'horizontal', alignItems: 'center',
            paddingTop: '6px', paddingBottom: '6px',
            contents: [
              { type: 'text', text: '🔒 รหัสโหลด', flex: 3, size: 'sm' },
              { type: 'text', flex: 2, size: 'sm', align: 'end',
                text: hasPassword ? `🔒 ${config.download_password}` : 'ไม่มี',
                color: hasPassword ? '#e65100' : '#aaaaaa' },
            ],
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📖 วิธีตั้งค่าด้วยคำสั่ง', weight: 'bold', size: 'sm', margin: 'md' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: 'ตั้งค่า บอท เปิด/ปิด\nตั้งค่า ข้อความ เปิด/ปิด\nตั้งค่า รูป เปิด/ปิด\nตั้งค่า ไฟล์ เปิด/ปิด\nตั้งค่า ลิงก์รูป เปิด/ปิด\nตั้งค่า ลิงก์ไฟล์ เปิด/ปิด\nตั้งค่า รหัส [รหัส]\nตั้งค่า รหัส ยกเลิก',
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '👥 จัดการผู้ดูแล', weight: 'bold', size: 'sm', margin: 'md' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: 'เพิ่มผู้ดูแล\nรายชื่อผู้ดูแล\nลบผู้ดูแล',
          },
        ],
      },
    },
  };
}
