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

  // ส่ง link กลับใน LINE
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (baseUrl) {
    const config = await getGroup(groupId);
    const hasPassword = config?.download_password ? ' 🔒' : '';
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `📸 บันทึกรูปภาพแล้ว${hasPassword}\nดาวน์โหลดได้ที่: ${baseUrl}/dl/${msg.id}` }],
      });
    } catch { /* replyToken หมดอายุ ไม่ต้องทำอะไร */ }
  }

  // วิเคราะห์รูปด้วย AI
  const config = await getGroup(groupId);
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
