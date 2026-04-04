import { WebhookEvent, MessageEvent, JoinEvent } from '@line/bot-sdk';
import { handleText } from './textHandler';
import { handleImage } from './imageHandler';
import { handleFile } from './fileHandler';
import { getGroup, upsertGroup } from '../services/groupConfig';
import { client } from '../services/lineClient';
import logger from '../utils/logger';

export async function handleEvent(event: WebhookEvent) {
  // bot ถูกเชิญเข้ากลุ่ม
  if (event.type === 'join') {
    const joinEvent = event as JoinEvent;
    if (joinEvent.source.type !== 'group') return;
    const groupId = joinEvent.source.groupId;
    let config = await getGroup(groupId);
    if (!config) {
      config = await upsertGroup(groupId);
      console.log(`\n⏳ [JOIN] ${groupId} — รออนุมัติใน dashboard`);
    } else {
      console.log(`\n🔄 [REJOIN] ${groupId} status=${config.status}`);
    }

    // สร้างข้อความต้อนรับ
    const messages: any[] = [];
    if (config.welcome_enabled && config.welcome_text) {
      // ใช้ข้อความจาก config
      if (config.welcome_image_url) {
        messages.push({ type: 'image', originalContentUrl: config.welcome_image_url, previewImageUrl: config.welcome_image_url });
      }
      messages.push({ type: 'text', text: config.welcome_text });
    } else {
      // ข้อความ default
      messages.push({ type: 'text', text: '👋 สวัสดีครับ! บอทเข้าร่วมกลุ่มแล้ว\nกรุณารออนุมัติจาก Dashboard ก่อนเริ่มใช้งานครับ' });
    }

    try {
      await client.replyMessage({ replyToken: joinEvent.replyToken, messages });
    } catch (e: any) {
      console.log(`[JOIN] reply failed (ok): ${e.message}`);
    }
    return;
  }

  if (event.type !== 'message') return;

  const msgEvent = event as MessageEvent;
  if (msgEvent.source.type !== 'group') return;

  const groupId = msgEvent.source.groupId;

  // ดึง config ของกลุ่มนี้
  let config = await getGroup(groupId);
  if (!config) {
    config = await upsertGroup(groupId);
    console.log(`\n⏳ [NEW GROUP] ${groupId} — รออนุมัติใน dashboard`);
  }

  // pending = รออนุมัติ, rejected = ปฏิเสธ → ไม่ทำอะไร
  if (config.status !== 'approved') return;
  if (!config.enabled) return;

  switch (msgEvent.message.type) {
    case 'text':
      if (config.save_text) await handleText(msgEvent, groupId);
      break;
    case 'image':
      if (config.save_images) await handleImage(msgEvent, groupId);
      break;
    case 'file':
      if (config.save_files) await handleFile(msgEvent, groupId);
      break;
  }
}
