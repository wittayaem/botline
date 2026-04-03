import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const storagePath = process.env.STORAGE_PATH || './storage';

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function saveStream(stream: Readable, subDir: string, fileName: string): Promise<string> {
  const now = new Date();
  const year  = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  // โครงสร้าง: storage/images/2026/03/messageId.jpg
  const dir = path.join(storagePath, subDir, year, month);
  await ensureDir(dir);

  const filePath = path.join(dir, fileName);
  const writeStream = fs.createWriteStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    stream.on('error', reject);
  });

  return filePath;
}
