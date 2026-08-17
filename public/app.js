/*
 * app.js — shared client runtime.
 *
 * Store.subscribe(cb)  → cb(state) on every change
 * Store.send(action)   → returns a promise; rejects with a Thai message
 * Store.now()          → server-corrected epoch ms
 * Store.net            → 'online' | 'lost' | 'offline'
 *
 * If the server cannot be reached the whole app falls back to a local,
 * single-device mode backed by localStorage, using the same reducer.
 * A station can therefore still run its own timer when the wifi dies.
 */
(function () {
  'use strict';

  var R = window.Reducer;
  var LOCAL_KEY = 'basetimer.local.state';
  var PIN_KEY = 'basetimer.pin';

  var Store = {
    state: null,
    net: 'connecting',
    mode: 'starting', // firebase | server | local
    offline: false,
    pinRequired: false,
    roomId: '',
    _subs: [],
    _offset: 0, // serverNow - clientNow
    _es: null
  };

  Store.now = function () {
    return Date.now() + Store._offset;
  };

  Store.subscribe = function (cb) {
    Store._subs.push(cb);
    if (Store.state) cb(Store.state);
    return function () {
      Store._subs = Store._subs.filter(function (f) { return f !== cb; });
    };
  };

  Store._emit = function () {
    Store._subs.forEach(function (cb) {
      try { cb(Store.state); } catch (e) { console.error(e); }
    });
    document.dispatchEvent(new CustomEvent('net', { detail: Store.net }));
  };

  Store._absorb = function (payload) {
    if (payload.serverNow) Store._offset = payload.serverNow - Date.now();
    if (payload.state) Store.state = R.migrate(payload.state);
    Store._emit();
  };

  // ---------------------------------------------------------- offline mode

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return R.migrate(JSON.parse(raw));
    } catch (e) { /* corrupt storage — start clean */ }
    return R.defaultState();
  }

  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Store.state)); } catch (e) {}
  }

  Store._goOffline = function () {
    if (!Store.offline) {
      Store.offline = true;
      Store.mode = 'local';
      Store.state = loadLocal();
    }
    Store.net = 'offline';
    Store._emit();
  };

  // ---------------------------------------------------------- pin

  Store.pin = function (value) {
    if (value === undefined) {
      try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; }
    }
    try { localStorage.setItem(PIN_KEY, value); } catch (e) {}
    return value;
  };

  // ---------------------------------------------------------- send

  Store.send = function (action) {
    if (Store.offline) {
      var problem = R.apply(Store.state, action, Date.now());
      if (problem) return Promise.reject(new Error(problem));
      saveLocal();
      Store._emit();
      return Promise.resolve(Store.state);
    }
    if (Store.mode === 'firebase') {
      return window.FirebaseSync.send(action, Store);
    }
    var body = Object.assign({}, action);
    if (!body.pin) body.pin = Store.pin();
    return fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().catch(function () { return { ok: false, error: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ' }; })
          .then(function (data) {
            if (!res.ok || !data.ok) throw new Error(data.error || 'ส่งคำสั่งไม่สำเร็จ');
            Store._absorb(data);
            return Store.state;
          });
      })
      .catch(function (err) {
        if (err instanceof TypeError) throw new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
        throw err;
      });
  };

  // ---------------------------------------------------------- connect

  // Transport chain: Firebase (GitHub Pages) → server.js (LAN) → local only.
  Store.start = function () {
    if (window.FirebaseSync && window.FirebaseSync.configured()) {
      window.FirebaseSync.connect(Store).catch(function (err) {
        console.warn('Firebase ใช้ไม่ได้ →', err.message);
        UI.toast('ต่อ Firebase ไม่ได้ — ' + err.message);
        startServer();
      });
      return;
    }
    startServer();
  };

  function startServer() {
    // Relative paths so the pages also work from a sub-path (GitHub Pages).
    fetch('api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) { Store.pinRequired = !!c.pinRequired; })
      .catch(function () {});

    fetch('api/state')
      .then(function (r) {
        if (!r.ok) throw new Error('bad status');
        return r.json();
      })
      .then(function (payload) {
        Store.mode = 'server';
        Store.net = 'online';
        Store._absorb(payload);
        openStream();
      })
      .catch(function () {
        Store._goOffline();
      });

    function openStream() {
      if (!window.EventSource) return;
      var es = new EventSource('api/events');
      Store._es = es;
      es.addEventListener('state', function (ev) {
        Store.net = 'online';
        Store._absorb(JSON.parse(ev.data));
      });
      es.addEventListener('ping', function (ev) {
        var d = JSON.parse(ev.data);
        if (d.serverNow) Store._offset = d.serverNow - Date.now();
        if (Store.net !== 'online') { Store.net = 'online'; Store._emit(); }
      });
      es.onerror = function () {
        // EventSource retries on its own; just show that we are stale.
        if (Store.net !== 'lost') {
          Store.net = 'lost';
          Store._emit();
        }
      };
    }
  }

  // ---------------------------------------------------------- helpers

  var UI = {};

  UI.mmss = function (sec) {
    var s = Math.max(0, Math.round(Math.abs(sec)));
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }
    return m + ':' + String(r).padStart(2, '0');
  };

  UI.minutesWord = function (sec) {
    var m = Math.floor(Math.abs(sec) / 60);
    return m + ' นาที';
  };

  UI.clockTime = function (ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  // Visual bucket for a station right now.
  UI.phase = function (st, now) {
    if (st.status === 'idle') return 'idle';
    if (st.status === 'paused') return 'paused';
    var rem = R.remainingSec(st, now);
    if (st.status === 'done') return rem < 0 ? 'done-late' : 'done';
    if (rem < 0) return 'late';
    if (rem <= Math.min(120, R.totalSec(st) * 0.15)) return 'warn';
    return 'running';
  };

  UI.phaseClass = function (phase) {
    return ({
      idle: 's-idle',
      paused: 's-paused',
      running: 's-running',
      warn: 's-warn',
      late: 's-late',
      done: 's-done',
      'done-late': 's-done'
    })[phase] || 's-idle';
  };

  UI.phaseLabel = function (st, now) {
    var phase = UI.phase(st, now);
    var rem = R.remainingSec(st, now);
    switch (phase) {
      case 'idle': return 'ยังไม่เริ่ม';
      case 'paused': return 'หยุดพักอยู่';
      case 'warn': return 'ใกล้หมดเวลา';
      case 'late': return 'เกินเวลา ' + UI.mmss(rem);
      case 'done': return '✔ เสร็จแล้ว · ใช้ไป ' + UI.mmss(R.elapsedSec(st, now));
      case 'done-late': return '✔ เสร็จแล้ว · ช้าไป ' + UI.mmss(rem);
      default: return 'กำลังดำเนินการ';
    }
  };

  // What the big number shows: time left while running, time used once finished.
  UI.clockText = function (st, now) {
    if (st.status === 'done') return UI.mmss(R.elapsedSec(st, now));
    var rem = R.remainingSec(st, now);
    return (rem < 0 && st.status !== 'idle' ? '+' : '') + UI.mmss(rem);
  };

  // ---- audio alert (no asset files, works after any user gesture) ----

  var audioCtx = null;
  UI.unlockAudio = function () {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };

  UI.beep = function (times, freq) {
    UI.unlockAudio();
    if (!audioCtx) return;
    times = times || 1;
    freq = freq || 880;
    for (var i = 0; i < times; i++) {
      var t0 = audioCtx.currentTime + i * 0.28;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    }
    if (navigator.vibrate) navigator.vibrate(times > 1 ? [200, 100, 200] : 200);
  };

  // ---- keep the screen awake on the station phone / TV ----

  UI.keepAwake = function () {
    if (!navigator.wakeLock) return;
    var lock = null;
    var request = function () {
      navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
    };
    request();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !lock) request();
    });
  };

  UI.toast = function (msg) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  };

  UI.bindConn = function (el) {
    function paint() {
      el.dataset.net = Store.net;
      var where = Store.mode === 'firebase' ? ' · Firebase'
        : Store.mode === 'server' ? ' · เซิร์ฟเวอร์ในค่าย' : '';
      el.textContent = ({
        connecting: 'กำลังเชื่อมต่อ…',
        online: 'เชื่อมต่อแล้ว' + where,
        lost: 'สัญญาณหลุด — กำลังต่อใหม่',
        offline: 'โหมดเครื่องเดียว (ไม่ได้ซิงก์กับใคร)'
      })[Store.net] || Store.net;
      el.title = Store.roomId ? 'ห้อง: ' + Store.roomId : '';
    }
    document.addEventListener('net', paint);
    paint();
  };

  // Runs cb ~4x/second so clocks tick smoothly without redrawing the DOM tree.
  UI.tick = function (cb) {
    function loop() {
      try { cb(Store.now()); } catch (e) { console.error(e); }
      setTimeout(loop, 250);
    }
    loop();
  };

  window.Store = Store;
  window.UI = UI;
})();
