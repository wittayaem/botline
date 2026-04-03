import fs from 'fs';

const API_KEY       = process.env.OPENROUTER_API_KEY!;
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4-5';

export async function captionImage(filePath: string, model?: string): Promise<string> {
  const MODEL = model || DEFAULT_MODEL;
  if (!API_KEY) return '';
  if (!fs.existsSync(filePath)) return '';

  const imageData = fs.readFileSync(filePath).toString('base64');
  const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
  const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${imageData}` },
          },
          {
            type: 'text',
            text: `วิเคราะห์รูปภาพนี้อย่างละเอียดเป็นภาษาไทย โดยครอบคลุมทุกหัวข้อที่เกี่ยวข้อง:

1. ภาพรวม: อธิบายว่าภาพนี้คือภาพอะไร เกิดขึ้นที่ไหน บรรยากาศโดยรวม
2. สิ่งของและวัตถุ: ระบุสิ่งของ อุปกรณ์ ผลิตภัณฑ์ ยานพาหนะ หรือวัตถุทุกชิ้นที่เห็นพร้อมสีและรายละเอียด
3. บุคคล: จำนวนคน รูปลักษณ์ การแต่งกาย อิริยาบถ หรืออารมณ์ (ถ้ามี)
4. สถานที่และสภาพแวดล้อม: ในร่ม/กลางแจ้ง สถานที่ประเภทใด ฉากหลัง แสง เวลา
5. ข้อความหรือตัวอักษร: ถ้ามีข้อความในรูปให้คัดลอกมาด้วย
6. อาหารและเครื่องดื่ม: ถ้ามีอาหาร ระบุชื่อ วัตถุดิบหลัก ลักษณะ
7. กิจกรรม: มีกิจกรรมหรือเหตุการณ์อะไรเกิดขึ้นในภาพ
8. คำค้นหา: ระบุ keyword ภาษาไทยที่เหมาะสำหรับค้นหารูปนี้ เช่น ชื่อสิ่งของ สถานที่ กิจกรรม (คั่นด้วย, )

ตอบให้ครบถ้วนตามหัวข้อที่เกี่ยวข้อง ละเว้นหัวข้อที่ไม่มีในภาพได้`,
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${err}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export async function queryEquipmentDB(question: string): Promise<string> {
  const apiUrl    = process.env.EQUIPMENT_API_URL;
  const apiSecret = process.env.EQUIPMENT_API_SECRET;
  if (!apiUrl || !apiSecret) return '';

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: question, secret: apiSecret }),
    });
    if (!res.ok) return '';
    const data = await res.json() as any;
    return data.context || '';
  } catch {
    return '';
  }
}

export async function chatWithAI(question: string, model?: string, dbContext?: string): Promise<string> {
  const MODEL = model || process.env.OPENROUTER_CHAT_MODEL || DEFAULT_MODEL;
  if (!API_KEY) return '';

  const systemPrompt = dbContext
    ? `คุณเป็น AI assistant ของฝ่าย IT บริษัท Pruksamoney ตอบคำถามเป็นภาษาไทย กระชับ ตรงประเด็น\n\nข้อมูลจากระบบครุภัณฑ์:\n${dbContext}\n\nใช้ข้อมูลนี้ในการตอบคำถาม ถ้าข้อมูลไม่เพียงพอให้บอกว่าไม่พบในระบบ`
    : 'คุณเป็น AI assistant ที่ตอบคำถามเป็นภาษาไทย ตอบกระชับ ตรงประเด็น และเป็นประโยชน์ ถ้าคำถามเป็นภาษาไทยให้ตอบเป็นภาษาไทย ถ้าเป็นภาษาอื่นตอบในภาษานั้น';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: question },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${err}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || '';
}
