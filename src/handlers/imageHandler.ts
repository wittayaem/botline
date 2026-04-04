import { ImageEventMessage, MessageEvent } from '@line/bot-sdk';
import { blobClient, client } from '../services/lineClient';
import { saveStream } from '../services/storage';
import { saveMessage, updateCaption } from '../services/database';
import { captionImage } from '../services/vision';
import { getGroup } from '../services/groupConfig';
import { retry } from '../utils/retry';
import { Readable } from 'stream';
import logger from '../utils/logger';

export async function handleImage(event: MessageEvent, groupId: string) {
  const msg = event.message as ImageEventMessage;
  const senderId = event.source.userId || 'unknown';

  const filePath = await retry(async () => {
    const stream = await blobClient.getMessageContent(msg.id);
    return saveStream(stream as unknown as Readable, 'images', `${msg.id}.jpg`);
  });

  await saveMessage({
    message_id: msg.id,
    group_id: groupId,
    sender_id: senderId,
    type: 'image',
    file_path: filePath,
    timestamp: event.timestamp,
  });

  logger.info({ type: 'image', senderId, filePath }, 'Image saved');

  const config = await getGroup(groupId);

  // ส่ง link กลับใน LINE
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (baseUrl && config?.reply_images !== false) {
    const hasPassword = !!config?.download_password;
    const galleryUrl = `${baseUrl}/g/${groupId}`;
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: `📸 บันทึกรูปภาพแล้ว${hasPassword ? ' 🔒' : ''}`,
          contents: {
            type: 'bubble', size: 'kilo',
            body: {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                { type: 'text', text: '📸 บันทึกรูปภาพแล้ว', weight: 'bold', size: 'md' },
                { type: 'text', text: hasPassword ? '🔒 ใส่รหัสผ่านก่อนเข้าดู' : 'กดดูและเลือกโหลดรูปได้เลย', size: 'sm', color: '#888888', wrap: true },
              ],
            },
            footer: {
              type: 'box', layout: 'vertical',
              contents: [{
                type: 'button', style: 'primary', color: '#06c755',
                action: { type: 'uri', label: hasPassword ? '🔒 ดูรูปทั้งหมด' : '🖼️ ดูรูปทั้งหมด', uri: galleryUrl },
              }],
            },
          },
        }],
      });
    } catch { /* replyToken หมดอายุ */ }
  }

  // วิเคราะห์รูปด้วย AI
  if (!config || !config.ai_caption) return;

  const model = config.ai_model || undefined;
  captionImage(filePath, model)
    .then(caption => {
      if (caption) {
        updateCaption(msg.id, caption);
        logger.info({ messageId: msg.id, model: model || 'default', caption }, 'Caption saved');
      }
    })
    .catch(err => logger.error({ err }, 'Caption failed'));
}
