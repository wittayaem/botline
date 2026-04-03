# LINE Bot - บันทึกข้อความ รูปภาพ และไฟล์จากกลุ่ม

## วิธีรัน

### 1. รัน Server

```bash
npx tsx src/index.ts
```

หรือแบบ auto-reload เมื่อแก้โค้ด:

```bash
npm run dev
```

### 2. รัน ngrok (terminal ใหม่)

```bash
ngrok http 3000
```

copy URL ที่ได้ เช่น `https://xxxx.ngrok-free.app`

### 3. ตั้ง Webhook URL ใน LINE Console

**[เปิด LINE Developers Console](https://developers.line.biz/console/channel/2009582755/messaging-api)**

ใส่ Webhook URL:
```
https://xxxx.ngrok-free.app/webhook
```

กด **Verify** → ควรได้ Success

---

## คำสั่งส่งข้อความไปกลุ่ม

```bash
npm run send -- "ข้อความที่ต้องการส่ง"
```

---

## ไฟล์ที่บันทึก

| ประเภท | ที่เก็บ |
|---|---|
| ข้อความ (text) | `data/messages.jsonl` |
| รูปภาพ | `storage/images/YYYY-MM-DD/` |
| ไฟล์ | `storage/files/YYYY-MM-DD/` |

---

## ค่าใน .env

```
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
LINE_GROUP_ID=C101ef9c9875169fb556461bf35b12d4c
PORT=3000
```
# botlineuuu
# botline
