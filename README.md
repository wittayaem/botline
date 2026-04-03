# Botline — LINE Bot Dashboard

ระบบ LINE Bot สำหรับบันทึกข้อความ รูปภาพ และไฟล์จากกลุ่ม LINE พร้อม Dashboard สำหรับจัดการและดูข้อมูล

## ความสามารถ

- รับและบันทึกข้อความ รูปภาพ และไฟล์จากกลุ่ม LINE
- วิเคราะห์รูปภาพด้วย AI (OpenRouter)
- ค้นหาข้อมูลอุปกรณ์จากระบบภายใน
- Dashboard สำหรับดูและจัดการข้อมูล
- ระบบ Login / สมัครสมาชิก

## Tech Stack

- Node.js + TypeScript + Express
- MySQL
- LINE Bot SDK
- Docker + Docker Compose

---

## Deploy ด้วย Docker (Portainer)

### 1. เตรียม Environment Variables

ใส่ค่าต่อไปนี้ใน Portainer → Stack → Environment variables:

| Variable | ความหมาย |
|----------|-----------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Token จาก LINE Developers |
| `LINE_CHANNEL_SECRET` | Secret จาก LINE Developers |
| `LINE_GROUP_ID` | Group ID ของกลุ่ม LINE |
| `DB_USER` | ชื่อ user MySQL |
| `DB_PASS` | รหัสผ่าน MySQL |
| `DB_NAME` | ชื่อ database (default: botline) |
| `BASE_URL` | URL ของ server เช่น `http://192.168.11.188:3000` |
| `OPENROUTER_API_KEY` | API Key จาก OpenRouter |
| `DASHBOARD_PASSWORD` | รหัสผ่าน Dashboard |
| `SESSION_SECRET` | Secret key สำหรับ session |

### 2. สร้าง Stack ใน Portainer

1. ไปที่ **Stacks** → **Add stack**
2. ตั้งชื่อ: `botline`
3. เลือก **Repository**
   - URL: `https://github.com/wittayaem/botline`
   - Branch: `main`
   - Compose path: `docker-compose.yml`
4. ใส่ Environment variables
5. กด **Deploy the stack**

### 3. สร้างตาราง Database

เข้า phpMyAdmin ที่ `http://[server]:8080` แล้วรัน SQL:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4. เข้าใช้งาน

| URL | ความหมาย |
|-----|-----------|
| `http://[server]:3000` | Dashboard |
| `http://[server]:3000/webhook` | LINE Webhook URL |
| `http://[server]:3000/health` | Health check |
| `http://[server]:8080` | phpMyAdmin |

---

## อัปเดทโค้ด

```bash
# 1. หลังแก้โค้ดเสร็จ
pub "อธิบายสิ่งที่แก้ไข"

# 2. ไป Portainer → Stacks → botline → Pull and redeploy
```
