import { TextEventMessage, MessageEvent } from '@line/bot-sdk';
import { saveMessage, searchImages, getUncaptionedImages, updateCaption } from '../services/database';
import { captionImage, chatWithAI, queryEquipmentDB } from '../services/vision';
import { getGroup } from '../services/groupConfig';
import { client } from '../services/lineClient';
import { parseDateFromText, formatThaiDate } from '../utils/dateParser';
import logger from '../utils/logger';

// คำสั่งที่รองรับ
const SEARCH_PATTERN = /^(ค้นหารูปภาพ(?:ด้วยai)?|ค้นหารูป|หารูปภาพ|หารูป)\s+(.+)/i;
const AI_CHAT_PATTERN = /^ai\s+(.+)/i;

// Conversation state — จำ keyword ที่รอคำตอบ (2 นาที)
interface PendingSearch {
  keyword: string;
  groupId: string;
  expiresAt: number;
}
const pendingSearches = new Map<string, PendingSearch>(); // key: userId

function setPending(userId: string, keyword: string, groupId: string) {
  pendingSearches.set(userId, { keyword, groupId, expiresAt: Date.now() + 2 * 60 * 1000 });
}
function getPending(userId: string): PendingSearch | null {
  const p = pendingSearches.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingSearches.delete(userId); return null; }
  return p;
}
function clearPending(userId: string) { pendingSearches.delete(userId); }

export async function handleText(event: MessageEvent, groupId: string) {
  const msg = event.message as TextEventMessage;
  const senderId = event.source.userId || 'unknown';

  // 0. Check operator commands first (don't save command messages)
  const { handleCommand } = require('./commandHandler');
  const handled = await handleCommand(msg.text, event.replyToken, groupId, senderId);
  if (handled) return;

  await saveMessage({
    message_id: msg.id,
    group_id: groupId,
    sender_id: senderId,
    type: 'text',
    text: msg.text,
    timestamp: event.timestamp,
  });

  // 1. ตรวจคำสั่ง AI chat
  const aiMatch = msg.text.match(AI_CHAT_PATTERN);
  if (aiMatch) {
    const question = aiMatch[1].trim();
    const config = await getGroup(groupId);

    // ตรวจว่ากลุ่มนี้เปิดใช้ AI chat ไหม
    if (!config?.ai_chat) return;

    const model = config.ai_model || undefined;
    try {
      // ดึงข้อมูลจากระบบครุภัณฑ์ (ถ้าเปิดใช้งาน)
      const dbContext = config.ai_equipment ? await queryEquipmentDB(question) : '';
      const answer = await chatWithAI(question, model, dbContext || undefined);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: answer || '❌ ไม่สามารถตอบได้ในขณะนี้' }],
      });
    } catch (e: any) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ เกิดข้อผิดพลาด: ${e.message}` }],
      });
    }
    return;
  }

  // 2. ตรวจคำสั่งค้นหารูป
  const searchMatch = msg.text.match(SEARCH_PATTERN);
  if (searchMatch) {
    const keyword = searchMatch[2].trim();
    await handleImageSearch(event.replyToken, groupId, senderId, keyword);
    return;
  }

  // 3. ตรวจว่ามี pending search รออยู่ไหม (รอรับปี/เดือน)
  const pending = getPending(senderId);
  if (pending && pending.groupId === groupId) {
    const parsed = parseDateFromText(msg.text);
    if (parsed) {
      clearPending(senderId);
      await handleImageSearchWithDate(event.replyToken, groupId, senderId, pending.keyword, parsed);
      return;
    }
  }

  logger.info({ type: 'text', senderId, text: msg.text }, 'Text saved');
}

async function buildImageMessages(images: any[]): Promise<any[]> {
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  return images.slice(0, 4).map(img => ({
    type: 'image',
    originalContentUrl: `${baseUrl}/img?path=${encodeURIComponent(img.file_path)}`,
    previewImageUrl:    `${baseUrl}/img?path=${encodeURIComponent(img.file_path)}`,
  }));
}

async function handleImageSearch(
  replyToken: string, groupId: string, userId: string, keyword: string
) {
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl || baseUrl.includes('your-ngrok')) {
    await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '⚠️ กรุณาตั้งค่า BASE_URL ใน .env' }] });
    return;
  }

  const images = await searchImages(groupId, keyword);

  if (images.length > 0) {
    const imgMsgs = await buildImageMessages(images);
    await client.replyMessage({ replyToken, messages: [
      { type: 'text', text: `🔍 พบ ${images.length} รูปเกี่ยวกับ "${keyword}" (แสดง ${imgMsgs.length} รูป)` },
      ...imgMsgs,
    ]});
    return;
  }

  // ไม่เจอ → ถามปี/เดือน
  setPending(userId, keyword, groupId);
  await client.replyMessage({ replyToken, messages: [{
    type: 'text',
    text: `🔍 ไม่พบรูปที่เกี่ยวกับ "${keyword}"\n\nลองระบุเดือนหรือปีที่ส่งรูปไว้ได้เลยครับ\nตัวอย่าง: มกราคม 2568, 2568, 1/2568`,
  }]});
}

async function handleImageSearchWithDate(
  replyToken: string, groupId: string, userId: string,
  keyword: string, parsed: { year: number; month?: number }
) {
  const { year, month } = parsed;
  const dateLabel = formatThaiDate(year, month);

  // ค้นหาอีกครั้งพร้อมกรองวันที่
  const images = await searchImages(groupId, keyword, year, month);

  if (images.length > 0) {
    const imgMsgs = await buildImageMessages(images);
    await client.replyMessage({ replyToken, messages: [
      { type: 'text', text: `🔍 พบ ${images.length} รูปเกี่ยวกับ "${keyword}" ใน${dateLabel} (แสดง ${imgMsgs.length} รูป)` },
      ...imgMsgs,
    ]});
    return;
  }

  // ยังไม่เจอ → re-analyze รูปในช่วงนั้นที่ยังไม่มี caption
  await client.replyMessage({ replyToken, messages: [{
    type: 'text',
    text: `⏳ ไม่พบรูปที่ตรงกันใน${dateLabel}\nกำลังวิเคราะห์รูปในช่วงนั้นใหม่ รอสักครู่...`,
  }]});

  const uncaptioned = await getUncaptionedImages(groupId, year, month);
  if (uncaptioned.length === 0) {
    await client.pushMessage({ to: groupId, messages: [{
      type: 'text',
      text: `❌ ไม่พบรูปที่เกี่ยวกับ "${keyword}" ใน${dateLabel} เลยครับ`,
    }]});
    return;
  }

  // วิเคราะห์รูปที่ไม่มี caption ใน background
  let reanalyzed = 0;
  for (const img of uncaptioned) {
    try {
      const caption = await captionImage(img.file_path);
      if (caption) { await updateCaption(img.message_id, caption); reanalyzed++; }
    } catch { /* skip */ }
  }

  // ค้นหาอีกครั้งหลัง re-analyze
  const retry = await searchImages(groupId, keyword, year, month);
  if (retry.length > 0) {
    const imgMsgs = await buildImageMessages(retry);
    await client.pushMessage({ to: groupId, messages: [
      { type: 'text', text: `✅ วิเคราะห์ ${reanalyzed} รูปใหม่แล้ว พบ ${retry.length} รูปเกี่ยวกับ "${keyword}" ใน${dateLabel}` },
      ...imgMsgs,
    ]});
  } else {
    await client.pushMessage({ to: groupId, messages: [{
      type: 'text',
      text: `❌ วิเคราะห์ ${reanalyzed} รูปแล้ว แต่ไม่พบรูปที่เกี่ยวกับ "${keyword}" ใน${dateLabel} เลยครับ`,
    }]});
  }

  logger.info({ keyword, year, month, reanalyzed }, 'Re-analyze done');
}
