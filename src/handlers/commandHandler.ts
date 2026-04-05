import { PostbackEvent } from '@line/bot-sdk';
import { client } from '../services/lineClient';
import { getGroup, updateGroup } from '../services/groupConfig';
import { isOperator, canManageOperators, addOperator, removeOperator, getOperators } from '../services/operators';
import logger from '../utils/logger';

// pending "เพิ่มผู้ดูแล" mode: groupId → { expiresAt, triggeredBy }
const pendingAdd = new Map<string, { expiresAt: number; triggeredBy: string }>();

// pending "ตั้งรหัสผ่านใหม่" mode: groupId → { expiresAt, triggeredBy }
const pendingPassword = new Map<string, { expiresAt: number; triggeredBy: string }>();

export function isPendingPassword(groupId: string): boolean {
  const p = pendingPassword.get(groupId);
  if (!p) return false;
  if (Date.now() > p.expiresAt) { pendingPassword.delete(groupId); return false; }
  return true;
}

export function getPendingPasswordTrigger(groupId: string): string {
  return pendingPassword.get(groupId)?.triggeredBy ?? '';
}

export async function handlePendingPassword(groupId: string, newPassword: string, replyToken: string) {
  pendingPassword.delete(groupId);
  if (newPassword === 'ยกเลิก') {
    try {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '↩️ ยกเลิกการตั้งรหัสผ่านแล้ว' }] });
    } catch {}
    return;
  }
  await updateGroup(groupId, { download_password: newPassword } as any);
  const masked = newPassword.length <= 2
    ? '*'.repeat(newPassword.length)
    : newPassword[0] + '*'.repeat(newPassword.length - 2) + newPassword.slice(-1);
  try {
    await client.replyMessage({ replyToken, messages: [{
      type: 'text',
      text: `🔒 ตั้งรหัสดาวน์โหลดใหม่แล้ว\nรหัส: ${masked}`,
    }]});
  } catch {}
}

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

  // คำสั่งสาธารณะ — ใครก็พิมพ์ได้
  const publicCmds = ['ดูไฟล์', 'ดูรูป', 'ดาวน์โหลด', 'โหลดไฟล์', 'ลิ้งกลุ่ม', 'คู่มือ'];
  if (publicCmds.includes(t)) {
    const config = await getGroup(groupId);
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl || !config) return false;

    // "คู่มือ" — ส่ง guide card
    if (t === 'คู่มือ') {
      try {
        await client.replyMessage({ replyToken, messages: [buildGuideMessage(groupId, baseUrl, config)] });
      } catch {}
      return true;
    }

    // ลิ้งแกลเลอรี่
    const hasPassword = !!config.download_password;
    const galleryUrl = `${baseUrl}/g/${groupId}`;
    try {
      await client.replyMessage({ replyToken, messages: [{
        type: 'flex',
        altText: '📂 ดูไฟล์และรูปภาพกลุ่ม',
        contents: {
          type: 'bubble', size: 'kilo',
          body: {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              { type: 'text', text: '📂 ไฟล์และรูปภาพกลุ่ม', weight: 'bold', size: 'md' },
              { type: 'text', text: hasPassword ? '🔒 ต้องใส่รหัสผ่านก่อนเข้าดู' : 'ดูและโหลดรูปภาพหรือไฟล์ได้เลย', size: 'sm', color: '#888888', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{
              type: 'button', style: 'primary', color: '#06c755',
              action: { type: 'uri', label: hasPassword ? '🔒 เข้าดูไฟล์ทั้งหมด' : '📂 เข้าดูไฟล์ทั้งหมด', uri: galleryUrl },
            }],
          },
        },
      }]});
    } catch {}
    return true;
  }

  // "สมัครผู้ดูแล" — bootstrap: ใช้ได้เมื่อกลุ่มนี้ยังไม่มี operator คนใดเลย
  if (t === 'สมัครผู้ดูแล') {
    const ops = await getOperators(groupId);
    if (ops.length > 0) {
      await client.replyMessage({ replyToken, messages: [{
        type: 'text',
        text: '⚠️ กลุ่มนี้มีผู้ดูแลอยู่แล้ว\nให้ผู้ดูแลที่มีสิทธิ์ 👑 ใช้คำสั่ง เพิ่มผู้ดูแล แทน',
      }]});
      return true;
    }
    let displayName = senderId;
    try {
      const profile = await client.getGroupMemberProfile(groupId, senderId);
      displayName = profile.displayName;
    } catch {}
    await addOperator(groupId, senderId, displayName, true);
    await client.replyMessage({ replyToken, messages: [{
      type: 'text',
      text: `✅ ลงทะเบียนเป็นผู้ดูแลกลุ่มแล้ว!\n👑 ${displayName}\n\nพิมพ์ ตั้งค่า เพื่อดูเมนูตั้งค่ากลุ่มได้เลยครับ`,
    }]});
    return true;
  }

  const op = await isOperator(groupId, senderId);
  if (!op) return false;

  // "//" — show settings card (shortcut)
  if (t === '//') {
    const config = await getGroup(groupId);
    if (!config) return false;
    try {
      await client.replyMessage({ replyToken, messages: [buildSettingsMessage(config)] });
    } catch {}
    return true;
  }

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
      text: '⏳ ให้ผู้ที่ต้องการเป็นผู้ดูแล พิมพ์อะไรมาก็ได้ ภายใน 60 วินี้',
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

  const parts = event.postback.data.split('|');
  const action = parts[0];

  // "setpassword|groupId"
  if (action === 'setpassword' && parts[1] === groupId) {
    pendingPassword.set(groupId, { expiresAt: Date.now() + 60_000, triggeredBy: senderId });
    try {
      await client.replyMessage({ replyToken: event.replyToken, messages: [{
        type: 'text',
        text: '🔑 ตั้งรหัสผ่านใหม่\nพิมพ์รหัสที่ต้องการมาได้เลย ภายใน 60 วินี้\n(พิมพ์ ยกเลิก เพื่อยกเลิก)',
      }]});
    } catch {}
    return;
  }

  // "showcmds|groupId"
  if (action === 'showcmds' && parts[1] === groupId) {
    try {
      await client.replyMessage({ replyToken: event.replyToken, messages: [buildTextCommandsCard()] });
    } catch {}
    return;
  }

  // "toggle|groupId|field|newValue"
  if (action !== 'toggle' || parts.length < 4) return;
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

export function buildGuideMessage(groupId: string, baseUrl: string, config: any): any {
  const galleryUrl = `${baseUrl}/g/${groupId}`;
  const hasPassword = !!config?.download_password;

  const btn = (label: string, action: any, color = '#06c755') => ({
    type: 'button', style: 'primary', color, height: 'sm', margin: 'sm',
    action,
  });
  const msgBtn = (label: string, text: string, color = '#06c755') =>
    btn(label, { type: 'message', label, text }, color);
  const uriBtn = (label: string, uri: string, color = '#06c755') =>
    btn(label, { type: 'uri', label, uri }, color);

  const logoUrl = `${baseUrl}/public/logo.png`;

  return {
    type: 'flex',
    altText: '📖 คู่มือคำสั่งบอท',
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: logoUrl,
        size: 'full',
        aspectRatio: '20:7',
        aspectMode: 'cover',
      },
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#06c755', paddingAll: '16px',
        contents: [
          { type: 'text', text: '📖 คู่มือคำสั่งบอท', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'กดปุ่มเพื่อใช้คำสั่งได้เลย', color: '#d4f5e2', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // ===== ทุกคน =====
          { type: 'text', text: '🌐 ทุกคนใช้ได้', weight: 'bold', size: 'sm', color: '#06c755' },
          uriBtn(hasPassword ? '🔒 ดูรูปและไฟล์ทั้งหมด' : '📂 ดูรูปและไฟล์ทั้งหมด', galleryUrl),
          msgBtn('📖 คู่มือ', 'คู่มือ', '#26a69a'),

          { type: 'separator', margin: 'md' },

          // ===== ผู้ดูแล — ตั้งค่า =====
          { type: 'text', text: '⚙️ ผู้ดูแล — ตั้งค่ากลุ่ม', weight: 'bold', size: 'sm', color: '#e65100', margin: 'md' },
          msgBtn('⚙️ ตั้งค่า — เปิดการ์ดตั้งค่า', 'ตั้งค่า', '#e65100'),

          { type: 'separator', margin: 'md' },

          // ===== ผู้ดูแล — จัดการ =====
          { type: 'text', text: '👥 ผู้ดูแล — จัดการสมาชิก', weight: 'bold', size: 'sm', color: '#e65100', margin: 'md' },
          msgBtn('➕ เพิ่มผู้ดูแล', 'เพิ่มผู้ดูแล', '#e65100'),
          msgBtn('📋 รายชื่อผู้ดูแล', 'รายชื่อผู้ดูแล', '#78909c'),
          msgBtn('➖ ลบผู้ดูแล', 'ลบผู้ดูแล', '#c62828'),
          msgBtn('🔑 สมัครผู้ดูแล (คนแรก)', 'สมัครผู้ดูแล', '#6d4c41'),

        ],
      },
    },
  };
}

export function buildTextCommandsCard(): any {
  return {
    type: 'flex',
    altText: '⌨️ คำสั่งแบบพิมพ์เอง',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#37474f', paddingAll: '14px',
        contents: [
          { type: 'text', text: '⌨️ คำสั่งแบบพิมพ์เอง', color: '#ffffff', size: 'md', weight: 'bold' },
          { type: 'text', text: 'สำหรับผู้ดูแลกลุ่มเท่านั้น', color: '#b0bec5', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          { type: 'text', text: '⚙️ ตั้งค่า', weight: 'bold', size: 'sm', color: '#37474f' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: '//  →  เปิดหน้าตั้งค่า\nตั้งค่า บอท เปิด / ปิด\nตั้งค่า รูป เปิด / ปิด\nตั้งค่า ไฟล์ เปิด / ปิด\nตั้งค่า ข้อความ เปิด / ปิด\nตั้งค่า ลิงก์รูป เปิด / ปิด\nตั้งค่า ลิงก์ไฟล์ เปิด / ปิด',
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🔒 รหัสดาวน์โหลด', weight: 'bold', size: 'sm', color: '#37474f', margin: 'md' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: 'ตั้งค่า รหัส abc123  →  ตั้งรหัสใหม่\nตั้งค่า รหัส ยกเลิก  →  ลบรหัสออก',
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '👥 จัดการผู้ดูแล', weight: 'bold', size: 'sm', color: '#37474f', margin: 'md' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: 'เพิ่มผู้ดูแล\nรายชื่อผู้ดูแล\nลบผู้ดูแล [ลำดับ หรือ ชื่อ]',
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🌐 ทุกคนใช้ได้', weight: 'bold', size: 'sm', color: '#37474f', margin: 'md' },
          {
            type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm',
            text: 'ดูไฟล์ / ดูรูป / ดาวน์โหลด  →  ลิ้งดูไฟล์\nคู่มือ  →  คู่มือคำสั่งทั้งหมด',
          },
        ],
      },
    },
  };
}

export function buildSettingsMessage(config: any): any {
  const gid = config.group_id;
  const hasPassword = !!config.download_password;
  const maskedPassword = hasPassword
    ? config.download_password.length <= 2
      ? '*'.repeat(config.download_password.length)
      : config.download_password[0] + '*'.repeat(config.download_password.length - 2) + config.download_password.slice(-1)
    : '';

  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const galleryUrl = `${baseUrl}/g/${gid}`;

  function toggleRow(label: string, field: string, current: boolean) {
    return {
      type: 'box', layout: 'horizontal', alignItems: 'center',
      paddingTop: '6px', paddingBottom: '6px',
      contents: [
        { type: 'text', text: label, flex: 3, size: 'sm' },
        {
          type: 'button', flex: 2, height: 'sm',
          style: current ? 'primary' : 'secondary',
          color: current ? '#06c755' : '#aaaaaa',
          action: {
            type: 'postback',
            label: current ? '✅ เปิด' : '❌ ปิด',
            data: `toggle|${gid}|${field}|${!current}`,
          },
        },
      ],
    };
  }

  function msgBtn(label: string, text: string, color = '#e65100') {
    return {
      type: 'button', style: 'primary', color, height: 'sm', margin: 'xs',
      action: { type: 'message', label, text },
    };
  }

  const logoUrl = `${baseUrl}/public/logo.png`;

  return {
    type: 'flex',
    altText: '⚙️ ตั้งค่ากลุ่ม',
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: logoUrl,
        size: 'full',
        aspectRatio: '20:7',
        aspectMode: 'cover',
      },
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#06c755', paddingAll: '16px',
        contents: [
          { type: 'text', text: '⚙️ ตั้งค่ากลุ่ม', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'กดปุ่มเพื่อสลับ เปิด / ปิด', color: '#d4f5e2', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // ─── บอท ───
          toggleRow('🤖 เปิด-ปิดบอท', 'enabled', config.enabled),
          { type: 'separator', margin: 'sm' },

          // ─── บันทึก ───
          { type: 'text', text: '📥 บันทึกข้อมูล', size: 'xs', color: '#888888', margin: 'sm' },
          toggleRow('💬 ข้อความ', 'save_text', config.save_text),
          toggleRow('📸 รูปภาพ', 'save_images', config.save_images),
          toggleRow('📁 ไฟล์', 'save_files', config.save_files),
          { type: 'separator', margin: 'sm' },

          // ─── ส่งลิ้งกลับ ───
          { type: 'text', text: '📤 ส่งลิ้งกลับหลังอัปโหลด', size: 'xs', color: '#888888', margin: 'sm' },
          toggleRow('🖼️ ลิ้งโหลดรูป', 'reply_images', config.reply_images !== false),
          toggleRow('📄 ลิ้งโหลดไฟล์', 'reply_files', config.reply_files !== false),
          { type: 'separator', margin: 'sm' },

          // ─── รหัส ───
          { type: 'text', text: '🔒 รหัสดาวน์โหลด', size: 'xs', color: '#888888', margin: 'sm' },
          {
            type: 'box', layout: 'horizontal', alignItems: 'center',
            paddingTop: '4px', paddingBottom: '4px',
            contents: [
              {
                type: 'text', flex: 3, size: 'sm',
                text: hasPassword ? `🔑 ${maskedPassword}` : '— ไม่มีรหัส —',
                color: hasPassword ? '#e65100' : '#aaaaaa',
              },
              {
                type: 'button', flex: 2, height: 'sm',
                style: 'secondary', color: '#e65100',
                action: { type: 'postback', label: '🔑 ตั้งใหม่', data: `setpassword|${gid}` },
              },
            ],
          },
          { type: 'separator', margin: 'sm' },

          // ─── ผู้ดูแล ───
          { type: 'text', text: '👥 จัดการผู้ดูแล', size: 'xs', color: '#888888', margin: 'sm' },
          {
            type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
            contents: [
              msgBtn('➕ เพิ่มผู้ดูแล', 'เพิ่มผู้ดูแล'),
              msgBtn('📋 รายชื่อ', 'รายชื่อผู้ดูแล', '#78909c'),
            ],
          },
          msgBtn('➖ ลบผู้ดูแล', 'ลบผู้ดูแล', '#c62828'),
          { type: 'separator', margin: 'sm' },

          // ─── ทุกคน ───
          { type: 'text', text: '🌐 ทุกคนใช้ได้', size: 'xs', color: '#888888', margin: 'sm' },
          {
            type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
            contents: [
              {
                type: 'button', style: 'primary', color: '#26a69a', height: 'sm', flex: 1,
                action: { type: 'message', label: '📖 คู่มือ', text: 'คู่มือ' },
              },
              {
                type: 'button', style: 'primary', color: '#06c755', height: 'sm', flex: 1,
                action: { type: 'uri', label: hasPassword ? '🔒 ดูไฟล์' : '📂 ดูไฟล์', uri: galleryUrl },
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [{
          type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label: '⌨️ ดูคำสั่งแบบพิมพ์เอง', data: `showcmds|${gid}` },
        }],
      },
    },
  };
}
