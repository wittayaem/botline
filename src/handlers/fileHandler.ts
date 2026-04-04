import { FileEventMessage, MessageEvent } from '@line/bot-sdk';
import { blobClient, client } from '../services/lineClient';
import { saveStream } from '../services/storage';
import { saveMessage } from '../services/database';
import { getGroup } from '../services/groupConfig';
import { retry } from '../utils/retry';
import { Readable } from 'stream';
import logger from '../utils/logger';

export async function handleFile(event: MessageEvent, groupId: string) {
  const msg = event.message as FileEventMessage;
  const senderId = event.source.userId || 'unknown';
  const safeFileName = `${msg.id}-${msg.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const filePath = await retry(async () => {
    const stream = await blobClient.getMessageContent(msg.id);
    return saveStream(stream as unknown as Readable, 'files', safeFileName);
  });

  await saveMessage({
    message_id: msg.id,
    group_id: groupId,
    sender_id: senderId,
    type: 'file',
    file_name: msg.fileName,
    file_size: Number(msg.fileSize),
    file_path: filePath,
    timestamp: event.timestamp,
  });

  logger.info({ type: 'file', senderId, fileName: msg.fileName, filePath }, 'File saved');

  // ส่ง link กลับใน LINE
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const config = await getGroup(groupId);
  if (baseUrl && config?.reply_files !== false) {
    const hasPassword = !!config?.download_password;
    const galleryUrl = `${baseUrl}/g/${groupId}`;
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: `📁 บันทึกไฟล์แล้ว${hasPassword ? ' 🔒' : ''}`,
          contents: {
            type: 'bubble', size: 'kilo',
            body: {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                { type: 'text', text: '📁 บันทึกไฟล์แล้ว', weight: 'bold', size: 'md' },
                { type: 'text', text: msg.fileName, size: 'sm', color: '#555555', wrap: true },
                { type: 'text', text: hasPassword ? '🔒 ใส่รหัสผ่านก่อนเข้าดู' : 'กดดูและเลือกโหลดไฟล์ได้เลย', size: 'sm', color: '#888888', wrap: true },
              ],
            },
            footer: {
              type: 'box', layout: 'vertical',
              contents: [{
                type: 'button', style: 'primary', color: '#06c755',
                action: { type: 'uri', label: hasPassword ? '🔒 ดูไฟล์ทั้งหมด' : '📁 ดูไฟล์ทั้งหมด', uri: galleryUrl },
              }],
            },
          },
        }],
      });
    } catch { /* replyToken หมดอายุ */ }
  }
}
