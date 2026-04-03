import { FileEventMessage, MessageEvent } from '@line/bot-sdk';
import { blobClient } from '../services/lineClient';
import { saveStream } from '../services/storage';
import { saveMessage } from '../services/database';
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

  saveMessage({
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
}
