import { WebhookEvent, MessageEvent, JoinEvent, PostbackEvent } from '@line/bot-sdk';
import { handleText } from './textHandler';
import { handleImage } from './imageHandler';
import { handleFile } from './fileHandler';
import { getGroup, upsertGroup } from '../services/groupConfig';
import { getWelcomeConfig } from '../services/settings';
import { client } from '../services/lineClient';
import { handlePostback, isPendingAddOperator, getPendingAddTrigger, handlePendingAddOperator } from './commandHandler';
import logger from '../utils/logger';

async function sendWelcome(replyToken: string) {
  const w = await getWelcomeConfig();
  if (!w.welcome_enabled || !w.welcome_text) return;
  const messages: any[] = [];
  if (w.welcome_image_url) {
    messages.push({ type: 'image', originalContentUrl: w.welcome_image_url, previewImageUrl: w.welcome_image_url });
  }
  messages.push({ type: 'text', text: w.welcome_text });
  try { await client.replyMessage({ replyToken, messages }); } catch {}
}

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

    await sendWelcome(joinEvent.replyToken);
    return;
  }

  if (event.type === 'postback') {
    await handlePostback(event as PostbackEvent);
    return;
  }

  if (event.type !== 'message') return;

  const msgEvent = event as MessageEvent;
  const replyToken = msgEvent.replyToken;

  // กลุ่ม: ตรวจสอบ approval
  if (msgEvent.source.type === 'group') {
    const groupId = msgEvent.source.groupId;
    let config = await getGroup(groupId);
    if (!config) {
      config = await upsertGroup(groupId);
      console.log(`\n⏳ [NEW GROUP] ${groupId} — รออนุมัติใน dashboard`);
    }

    // approved → ไม่ส่ง welcome ไม่ว่า enabled จะเป็น true หรือ false
    if (config.status === 'approved') {
      if (!config.enabled) return; // ปิดบอทอยู่ — ไม่ทำอะไร

      const senderId = msgEvent.source.userId || '';

      // Check pending "เพิ่มผู้ดูแล" mode
      if (isPendingAddOperator(groupId)) {
        const trigger = getPendingAddTrigger(groupId);
        if (senderId !== trigger) {
          let displayName = senderId;
          try {
            const profile = await client.getGroupMemberProfile(groupId, senderId);
            displayName = profile.displayName;
          } catch {}
          await handlePendingAddOperator(groupId, senderId, displayName);
          return;
        }
      }

      switch (msgEvent.message.type) {
        case 'text':  if (config.save_text)   await handleText(msgEvent, groupId);  break;
        case 'image': if (config.save_images) await handleImage(msgEvent, groupId); break;
        case 'file':  if (config.save_files)  await handleFile(msgEvent, groupId);  break;
      }
      return;
    }
  }

  // pending / rejected หรือ DM → ส่ง welcome
  await sendWelcome(replyToken);
}
