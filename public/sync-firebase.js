/*
 * sync-firebase.js — shared state over Firebase Realtime Database.
 *
 * This is what makes the app work on GitHub Pages, which can only serve
 * static files and cannot run server.js. Every phone talks to Firebase
 * directly instead of to our own server.
 *
 * The Firebase SDK is loaded lazily, and only when a databaseURL is
 * actually configured — so a laptop running server.js on camp wifi with
 * no internet never waits on the CDN.
 */
(function () {
  'use strict';

  var R = window.Reducer;
  var FS = { available: false, ref: null };

  function configured() {
    var c = window.FIREBASE_CONFIG;
    return !!(c && c.databaseURL && c.apiKey);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('โหลด Firebase SDK ไม่ได้ (เน็ตมีปัญหา?)')); };
      document.head.appendChild(s);
    });
  }

  function loadSdk() {
    var v = window.FIREBASE_SDK_VERSION || '10.12.2';
    var base = 'https://www.gstatic.com/firebasejs/' + v + '/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () { return loadScript(base + 'firebase-database-compat.js'); });
  }

  // Firebase keys cannot contain . # $ [ ] /
  function safeRoom(id) {
    return String(id || 'default').replace(/[.#$\[\]\/\s]/g, '-').slice(0, 80);
  }

  /**
   * Connect and stream room state into the Store.
   * Returns a promise that rejects if Firebase is unusable, so the caller
   * can fall back to server.js / offline mode.
   */
  FS.connect = function (Store) {
    if (!configured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Firebase'));

    return loadSdk().then(function () {
      if (typeof firebase === 'undefined') throw new Error('Firebase SDK ไม่พร้อมใช้งาน');

      firebase.initializeApp(window.FIREBASE_CONFIG);
      var db = firebase.database();
      var room = safeRoom(window.ROOM_ID);
      var ref = db.ref('rooms/' + room);
      FS.ref = ref;
      FS.available = true;
      Store.mode = 'firebase';
      Store.roomId = room;

      // Firebase tells us how far this device's clock is from its servers —
      // exactly the correction we need so every phone agrees on the time.
      db.ref('.info/serverTimeOffset').on('value', function (snap) {
        Store._offset = snap.val() || 0;
      });

      db.ref('.info/connected').on('value', function (snap) {
        Store.net = snap.val() ? 'online' : 'lost';
        Store._emit();
      });

      return new Promise(function (resolve, reject) {
        var settled = false;
        ref.on('value', function (snap) {
          var val = snap.val();
          if (!val) {
            // First device into an empty room seeds it.
            ref.transaction(function (cur) { return cur || R.defaultState(); });
            return;
          }
          Store.state = R.migrate(val);
          Store._emit();
          if (!settled) { settled = true; resolve(); }
        }, function (err) {
          if (!settled) {
            settled = true;
            reject(new Error('อ่านข้อมูลจาก Firebase ไม่ได้: ' + err.message));
          } else {
            Store.net = 'lost';
            Store._emit();
          }
        });

        // Don't hang forever on a misconfigured project.
        setTimeout(function () {
          if (!settled) {
            settled = true;
            reject(new Error('ต่อ Firebase ไม่ได้ภายใน 10 วินาที'));
          }
        }, 10000);
      });
    });
  };

  /**
   * Apply an action inside a transaction, so two staff pressing buttons at
   * the same moment cannot clobber each other's timers.
   */
  FS.send = function (action, Store) {
    if (!FS.ref) return Promise.reject(new Error('ยังไม่ได้เชื่อมต่อ Firebase'));
    var problem = null;

    return FS.ref.transaction(function (current) {
      problem = null;
      var next = current ? R.migrate(current) : R.defaultState();
      problem = R.apply(next, action, Store.now());
      if (problem) return; // abort the transaction
      return next;
    }).then(function (res) {
      if (problem) throw new Error(problem);
      if (!res || !res.committed) throw new Error('มีคนกดพร้อมกันพอดี ลองใหม่อีกครั้ง');
      return Store.state;
    }, function (err) {
      throw new Error('เขียนข้อมูลไม่สำเร็จ: ' + err.message);
    });
  };

  FS.configured = configured;
  window.FirebaseSync = FS;
})();
