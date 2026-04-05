import { VideoEventMessage, MessageEvent } from '@line/bot-sdk';
import { blobClient, client } from '../services/lineClient';
import { saveStream } from '../services/storage';
import { saveMessage } from '../services/database';
import { getGroup } from '../services/groupConfig';
import { retry } from '../utils/retry';
import { Readable } from 'stream';
import logger from '../utils/logger';

export async function handleVideo(event: MessageEvent, groupId: string) {
  const msg = event.message as VideoEventMessage;
  const senderId = event.source.userId || 'unknown';
  const fileName = `${msg.id}.mp4`;

  const filePath = await retry(async () => {
    const stream = await blobClient.getMessageContent(msg.id);
    return saveStream(stream as unknown as Readable, 'videos', fileName);
  });

  await saveMessage({
    message_id: msg.id,
    group_id: groupId,
    sender_id: senderId,
    type: 'video',
    file_name: fileName,
    file_path: filePath,
    timestamp: event.timestamp,
  });

  logger.info({ type: 'video', senderId, filePath }, 'Video saved');

  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const config = await getGroup(groupId);
  if (baseUrl && config?.reply_videos !== false) {
    const hasPassword = !!config?.download_password;
    const galleryUrl = `${baseUrl}/g/${groupId}`;
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: `🎬 บันทึกวิดีโอแล้ว${hasPassword ? ' 🔒' : ''}`,
          contents: {
            type: 'bubble', size: 'kilo',
            body: {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                { type: 'text', text: '🎬 บันทึกวิดีโอแล้ว', weight: 'bold', size: 'md' },
                { type: 'text', text: hasPassword ? '🔒 ใส่รหัสผ่านก่อนเข้าดู' : 'กดดูและเลือกโหลดวิดีโอได้เลย', size: 'sm', color: '#888888', wrap: true },
              ],
            },
            footer: {
              type: 'box', layout: 'vertical',
              contents: [{
                type: 'button', style: 'primary', color: '#1565c0',
                action: { type: 'uri', label: hasPassword ? '🔒 ดูวิดีโอทั้งหมด' : '🎬 ดูวิดีโอทั้งหมด', uri: galleryUrl },
              }],
            },
          },
        }],
      });
    } catch { /* replyToken หมดอายุ */ }
  }
}
