/*
 * ────────────────────────────────────────────────────────────────
 *  ค่าเชื่อมต่อ Firebase ของค่ายนี้
 *  โปรเจกต์: timer-b0a19
 * ────────────────────────────────────────────────────────────────
 *
 *  ตั้งค่าครบแล้ว พร้อมใช้งาน
 *
 *  ⚠️ databaseURL ต้องเป็นลิงก์ของ "ตัวฐานข้อมูล" (ลงท้าย .firebasedatabase.app)
 *     ไม่ใช่ลิงก์หน้าเว็บ console ที่ขึ้นในช่อง address bar
 *     (ลิงก์ console จะขึ้นต้นด้วย https://console.firebase.google.com/... — อันนั้นใช้ไม่ได้)
 */

window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAl9XRfK1LlkYwrg3DDWDpv0VHnbXfwJTk',
  authDomain: 'timer-b0a19.firebaseapp.com',
  projectId: 'timer-b0a19',
  appId: '1:578251028837:web:510e58c1ad6aa86c33098c',

  // ตรวจสอบแล้วว่าใช้งานได้จริง (อ่าน/เขียน/rules ผ่านหมด)
  databaseURL: 'https://timer-b0a19-default-rtdb.asia-southeast1.firebasedatabase.app'
};

/*
 *  ROOM_ID = ห้องของค่ายคุณ
 *
 *  ⚠️ ถ้า repo เป็น public ค่านี้จะเห็นได้ทุกคนบน GitHub
 *     ใครที่รู้ค่านี้ + รู้ลิงก์เว็บ กดปุ่มได้ทุกปุ่ม (รวมถึงรีเซ็ตเวลา)
 *     ถ้าอยากให้ปลอดภัยกว่านี้ บอกได้ เดี๋ยวเปลี่ยนไปอ่านจาก URL แทน
 *     จะได้ไม่ต้องเก็บค่านี้ไว้ในโค้ดเลย
 */
window.ROOM_ID = 'medcamp-2569-k7x2vq';

/*
 *  เวอร์ชัน Firebase SDK ที่จะโหลด (ไม่ต้องแก้)
 *
 *  หมายเหตุ: เลข 12.17.1 ที่ Firebase โชว์ในหน้าเว็บเป็น SDK แบบ module
 *  แต่แอปนี้ใช้แบบ compat ซึ่งทดสอบกับ 10.12.2 มาแล้ว จึงล็อกไว้เวอร์ชันนี้
 */
window.FIREBASE_SDK_VERSION = '10.12.2';
