const THAI_MONTHS: Record<string, number> = {
  'มกราคม': 1,  'มกรา': 1,  'ม.ค.': 1,  'มค': 1,
  'กุมภาพันธ์': 2, 'กุมภา': 2, 'ก.พ.': 2, 'กพ': 2,
  'มีนาคม': 3,  'มีนา': 3,  'มี.ค.': 3,  'มีค': 3,
  'เมษายน': 4,  'เมษา': 4,  'เม.ย.': 4,  'เมย': 4,
  'พฤษภาคม': 5, 'พฤษภา': 5, 'พ.ค.': 5,  'พค': 5,
  'มิถุนายน': 6, 'มิถุนา': 6,'มิ.ย.': 6, 'มิย': 6,
  'กรกฎาคม': 7, 'กรกฎา': 7, 'ก.ค.': 7,  'กค': 7,
  'สิงหาคม': 8, 'สิงหา': 8, 'ส.ค.': 8,  'สค': 8,
  'กันยายน': 9, 'กันยา': 9, 'ก.ย.': 9,  'กย': 9,
  'ตุลาคม': 10, 'ตุลา': 10, 'ต.ค.': 10, 'ตค': 10,
  'พฤศจิกายน': 11,'พฤศจิกา': 11,'พ.ย.': 11,'พย': 11,
  'ธันวาคม': 12,'ธันวา': 12, 'ธ.ค.': 12, 'ธค': 12,
};

export interface ParsedDate {
  year: number;
  month?: number;
}

// แปลง Buddhist Era → Christian Era ถ้าปีเกิน 2500
function toChristianYear(y: number): number {
  return y > 2500 ? y - 543 : y;
}

export function parseDateFromText(text: string): ParsedDate | null {
  // รูปแบบ: "มกราคม 2568" หรือ "มกรา 2568"
  for (const [name, monthNum] of Object.entries(THAI_MONTHS)) {
    const re = new RegExp(`${name}\\s*(\\d{4})`, 'i');
    const m = text.match(re);
    if (m) return { year: toChristianYear(Number(m[1])), month: monthNum };
  }

  // รูปแบบ: "1/2568" หรือ "01/2025"
  const slashMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (slashMatch) {
    return {
      year: toChristianYear(Number(slashMatch[2])),
      month: Number(slashMatch[1]),
    };
  }

  // รูปแบบ: ปีอย่างเดียว "2568" หรือ "2025"
  const yearOnly = text.match(/\b(25\d{2}|20\d{2})\b/);
  if (yearOnly) {
    return { year: toChristianYear(Number(yearOnly[1])) };
  }

  // "เดือนที่แล้ว"
  if (text.includes('เดือนที่แล้ว')) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  // "ปีที่แล้ว"
  if (text.includes('ปีที่แล้ว')) {
    return { year: new Date().getFullYear() - 1 };
  }

  return null;
}

export function formatThaiDate(year: number, month?: number): string {
  const thaiYear = year + 543;
  if (!month) return `ปี ${thaiYear}`;
  const monthNames = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${monthNames[month]} ${thaiYear}`;
}
