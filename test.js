/*
 * Tests for the timer maths. Run with:  node test.js
 * No test framework — plain assertions, exits non-zero on failure.
 */
'use strict';

const R = require('./public/reducer.js');

let pass = 0;
const failures = [];

function ok(name, cond, hint) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    failures.push(name + (hint ? '  → ' + hint : ''));
    console.log('  ✗ ' + name + (hint ? '  → ' + hint : ''));
  }
}

const T0 = 1000000;
const MIN = 60000;

// ---------------------------------------------------------------- a single run

{
  console.log('\nจับเวลาฐานเดียว');
  const s = R.defaultState();
  s.stations = [R.station('A', 10), R.station('B', 10)];
  const a = s.stations[0];

  R.apply(s, { type: 'station/start', id: a.id }, T0);
  ok('start ทำให้ฐานเดิน', a.status === 'running');
  ok('เริ่มต้นเหลือ 10 นาทีเต็ม', Math.round(R.remainingSec(a, T0)) === 600);
  ok('ผ่านไป 4 นาที เหลือ 6 นาที', Math.round(R.remainingSec(a, T0 + 4 * MIN)) === 360);

  R.apply(s, { type: 'station/pause', id: a.id }, T0 + 4 * MIN);
  ok('pause เก็บเวลาที่เดินไปแล้ว', Math.round(a.accumSec) === 240 && a.status === 'paused');
  ok('ระหว่าง pause นาฬิกาต้องไม่เดิน',
    Math.round(R.remainingSec(a, T0 + 10 * MIN)) === 360);

  R.apply(s, { type: 'station/resume', id: a.id }, T0 + 10 * MIN);
  ok('resume เดินต่อจากเดิม', Math.round(R.remainingSec(a, T0 + 11 * MIN)) === 300);

  R.apply(s, { type: 'station/extend', id: a.id, minutes: 5 }, T0 + 11 * MIN);
  ok('+5 นาที เพิ่มเวลาจริง',
    Math.round(R.remainingSec(a, T0 + 11 * MIN)) === 600 && a.extendMin === 5);

  const overtimeAt = T0 + 11 * MIN + 700000;
  ok('เกินเวลาแล้วค่าติดลบ', R.remainingSec(a, overtimeAt) < 0);

  R.apply(s, { type: 'station/finish', id: a.id }, overtimeAt);
  ok('finish ทำให้เป็น done', a.status === 'done' && !!a.finishedAt);
  const frozen = Math.round(R.elapsedSec(a, overtimeAt));
  ok('done แล้วเวลาหยุดนิ่ง', Math.round(R.elapsedSec(a, overtimeAt + 9 * MIN)) === frozen);

  R.apply(s, { type: 'station/extend', id: a.id, minutes: 5 }, overtimeAt + 9 * MIN);
  ok('ต่อเวลาให้ฐานที่กดจบไปแล้วได้', a.status === 'running');
}

// ---------------------------------------------------------------- rotation

{
  console.log('\nการหมุนกลุ่มตามรอบ');
  const s = R.defaultState();
  s.groups = ['G1', 'G2', 'G3'];
  s.round = 1;
  ok('รอบ 1 ฐานแรกคือ G1', R.groupAt(s, 0) === 'G1');
  ok('รอบ 1 ฐานสองคือ G2', R.groupAt(s, 1) === 'G2');

  R.apply(s, { type: 'round/next' }, T0);
  ok('round/next เพิ่มเลขรอบ', s.round === 2);
  ok('รอบ 2 ฐานแรกคือ G2', R.groupAt(s, 0) === 'G2');
  ok('round/next ล้างเวลาทุกฐาน',
    s.stations.every((x) => x.status === 'idle' && x.accumSec === 0 && x.extendMin === 0));

  ok('กลุ่มวนกลับมาครบรอบ', (function () {
    s.round = 4; // 3 groups → back to G1
    return R.groupAt(s, 0) === 'G1';
  })());
}

// ---------------------------------------------------------------- whole round

{
  console.log('\nคำสั่งระดับรอบ');
  const s = R.defaultState();
  R.apply(s, { type: 'round/startAll' }, T0);
  ok('startAll เริ่มทุกฐานพร้อมกัน', s.stations.every((x) => x.status === 'running'));
  ok('startAll บันทึกเวลาเริ่มรอบ', s.roundStartedAt === T0);

  R.apply(s, { type: 'round/stopAll' }, T0 + 5 * MIN);
  ok('stopAll ปิดทุกฐาน', s.stations.every((x) => x.status === 'done'));

  R.apply(s, { type: 'round/reset' }, T0 + 6 * MIN);
  ok('reset กลับไปรอบ 1', s.round === 1 && s.stations.every((x) => x.status === 'idle'));
}

// ---------------------------------------------------------------- guards

{
  console.log('\nการปฏิเสธคำสั่งที่ผิด');
  const s = R.defaultState();
  ok('ฐานที่ไม่มีอยู่ → error', R.apply(s, { type: 'station/start', id: 'nope' }, T0) !== null);
  ok('คำสั่งที่ไม่รู้จัก → error', R.apply(s, { type: 'bogus' }, T0) !== null);
  ok('บันทึกโดยไม่มีฐานเลย → error', R.apply(s, { type: 'config/save', stations: [] }, T0) !== null);
  ok('resume ฐานที่ไม่ได้ pause → error',
    R.apply(s, { type: 'station/resume', id: s.stations[0].id }, T0) !== null);
  ok('pause ฐานที่ยังไม่เริ่ม → error',
    R.apply(s, { type: 'station/pause', id: s.stations[0].id }, T0) !== null);
}

// ---------------------------------------------------------------- config edits

{
  console.log('\nแก้ตั้งค่าระหว่างกิจกรรมกำลังเดิน');
  const s = R.defaultState();
  const id = s.stations[0].id;
  R.apply(s, { type: 'station/start', id }, T0);
  R.apply(s, {
    type: 'config/save',
    stations: s.stations.map((x) => ({ id: x.id, name: x.name + '!', durationMin: 30 }))
  }, T0 + MIN);
  ok('เปลี่ยนชื่อแล้วเวลายังเดินอยู่',
    s.stations[0].status === 'running' && s.stations[0].name.endsWith('!'));
  ok('เปลี่ยนจำนวนนาทีมีผลทันที',
    Math.round(R.remainingSec(s.stations[0], T0 + MIN)) === 29 * 60);

  const before = s.stations.length;
  R.apply(s, {
    type: 'config/save',
    stations: s.stations.slice(0, 2).map((x) => ({ id: x.id, name: x.name, durationMin: x.durationMin }))
  }, T0 + 2 * MIN);
  ok('ลบฐานได้', s.stations.length === 2 && before > 2);

  R.apply(s, {
    type: 'config/save',
    stations: s.stations.concat([{ id: '', name: 'ฐานใหม่', durationMin: 15 }])
      .map((x) => ({ id: x.id, name: x.name, durationMin: x.durationMin }))
  }, T0 + 3 * MIN);
  ok('เพิ่มฐานใหม่ได้และได้ id ของตัวเอง',
    s.stations.length === 3 && !!s.stations[2].id && s.stations[2].name === 'ฐานใหม่');
}

// ---------------------------------------------------------------- migrate

{
  console.log('\nกู้สถานะจากไฟล์เก่า/พัง');
  ok('migrate(null) คืนค่าเริ่มต้น', R.migrate(null).stations.length > 0);
  ok('migrate ข้อมูลไม่ครบ เติมให้ครบ', R.migrate({ stations: [{ name: 'X' }] }).stations[0].status === 'idle');
  ok('migrate ของขยะไม่ทำให้พัง', R.migrate({ stations: 'not an array' }).stations.length > 0);
  ok('migrate รักษา id เดิม', R.migrate({ stations: [{ id: 'keepme', name: 'X' }] }).stations[0].id === 'keepme');
}

// ---------------------------------------------------------------- firebase shapes

{
  console.log('\nข้อมูลที่กลับมาจาก Firebase');

  // Firebase drops keys whose value is null, and hands arrays back as
  // objects keyed by index whenever the keys are not a dense sequence.
  function likeFirebase(value) {
    if (Array.isArray(value)) {
      const obj = {};
      value.forEach((v, i) => { obj[String(i)] = likeFirebase(v); });
      return obj;
    }
    if (value && typeof value === 'object') {
      const obj = {};
      Object.keys(value).forEach((k) => {
        if (value[k] === null || value[k] === undefined) return; // dropped
        obj[k] = likeFirebase(value[k]);
      });
      return obj;
    }
    return value;
  }

  const original = R.defaultState();
  original.groups = ['G1', 'G2'];
  R.apply(original, { type: 'station/start', id: original.stations[0].id }, T0);

  const revived = R.migrate(likeFirebase(original));
  ok('stations ที่กลายเป็น object กลับมาเป็น array ได้',
    Array.isArray(revived.stations) && revived.stations.length === original.stations.length);
  ok('groups ที่กลายเป็น object กลับมาได้',
    Array.isArray(revived.groups) && revived.groups.join() === 'G1,G2');
  ok('เรียงลำดับฐานถูกต้อง',
    revived.stations.map((x) => x.name).join() === original.stations.map((x) => x.name).join());
  ok('id ของฐานไม่เปลี่ยน', revived.stations[0].id === original.stations[0].id);
  ok('ฐานที่กำลังเดินยังเดินอยู่หลังรอบ Firebase',
    revived.stations[0].status === 'running' &&
    Math.round(R.remainingSec(revived.stations[0], T0 + 5 * MIN)) ===
    Math.round(R.remainingSec(original.stations[0], T0 + 5 * MIN)));
  ok('startedAt ที่เป็น null ถูกเติมกลับ', revived.stations[1].startedAt === null);
  ok('accumSec ที่หายไปกลายเป็น 0', revived.stations[1].accumSec === 0);

  // A key ordering Firebase can produce: string keys sorted lexically ("10" < "2")
  const many = R.defaultState();
  many.stations = [];
  for (let i = 0; i < 12; i++) many.stations.push(R.station('ฐาน ' + (i + 1), 10));
  const shuffled = {};
  Object.keys(likeFirebase(many.stations)).sort().forEach((k) => {
    shuffled[k] = likeFirebase(many.stations)[k];
  });
  const revived2 = R.migrate({ stations: shuffled });
  ok('12 ฐานเรียงตามตัวเลข ไม่ใช่ตามตัวอักษร',
    revived2.stations.map((x) => x.name).join() === many.stations.map((x) => x.name).join(),
    revived2.stations.slice(0, 3).map((x) => x.name).join());

  ok('ห้องว่าง (null) → ค่าเริ่มต้น', R.migrate(null).stations.length > 0);
  ok('ห้องที่มีแต่ขยะ → ค่าเริ่มต้น', R.migrate({ stations: {} }).stations.length > 0);
}

console.log('\n' + (failures.length
  ? '❌ ไม่ผ่าน ' + failures.length + ' ข้อ:\n   ' + failures.join('\n   ')
  : '✅ ผ่านทั้งหมด ' + pass + ' ข้อ'));

process.exit(failures.length ? 1 : 0);
