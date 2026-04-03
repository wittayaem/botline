import 'dotenv/config';
import { client } from '../services/lineClient';

async function main() {
  const text = process.argv[2];
  const groupId = process.argv[3] || process.env.LINE_GROUP_ID;

  if (!text) {
    console.error('Usage: npm run send -- "ข้อความ" [groupId]');
    process.exit(1);
  }

  if (!groupId) {
    console.error('กรุณาระบุ LINE_GROUP_ID ใน .env หรือ argument ที่ 2');
    process.exit(1);
  }

  try {
    await client.pushMessage({
      to: groupId,
      messages: [{ type: 'text', text }],
    });
    console.log(`ส่งข้อความสำเร็จ: "${text}" → ${groupId}`);
  } catch (err) {
    console.error('ส่งข้อความไม่สำเร็จ:', err);
    process.exit(1);
  }
}

main();
