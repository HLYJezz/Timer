/*
 * reducer.js — the single source of truth for state shape + actions.
 * Loaded by BOTH the Node server (require) and the browser (<script>),
 * so offline mode behaves exactly like online mode.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reducer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_VERSION = 1;

  function uid() {
    return 's' + Math.random().toString(36).slice(2, 8);
  }

  function station(name, durationMin) {
    return {
      id: uid(),
      name: name,
      staff: '',
      durationMin: durationMin,
      status: 'idle', // idle | running | paused | done
      startedAt: null, // epoch ms of the current running span
      accumSec: 0, // seconds banked from finished spans
      extendMin: 0, // extra minutes granted to this run
      help: false, // station is asking for help
      finishedAt: null,
      note: ''
    };
  }

  function defaultState() {
    return {
      v: STATE_VERSION,
      eventName: 'ค่ายกิจกรรม',
      round: 1,
      roundStartedAt: null,
      announcement: { text: '', at: 0 },
      groups: ['กลุ่ม 1', 'กลุ่ม 2', 'กลุ่ม 3', 'กลุ่ม 4', 'กลุ่ม 5', 'กลุ่ม 6'],
      stations: [
        station('ฐาน 1', 20),
        station('ฐาน 2', 20),
        station('ฐาน 3', 20),
        station('ฐาน 4', 20),
        station('ฐาน 5', 20),
        station('ฐาน 6', 20)
      ],
      updatedAt: Date.now()
    };
  }

  // ---- time maths (used by server and every client) ----

  function elapsedSec(st, now) {
    if (st.status === 'running' && st.startedAt) {
      return st.accumSec + (now - st.startedAt) / 1000;
    }
    return st.accumSec;
  }

  function totalSec(st) {
    return (st.durationMin + st.extendMin) * 60;
  }

  function remainingSec(st, now) {
    return totalSec(st) - elapsedSec(st, now);
  }

  // The group currently standing at station #index, given a rotation round.
  function groupAt(state, index) {
    var n = state.groups.length;
    if (!n) return '';
    return state.groups[(index + state.round - 1) % n];
  }

  function find(state, id) {
    for (var i = 0; i < state.stations.length; i++) {
      if (state.stations[i].id === id) return state.stations[i];
    }
    return null;
  }

  function clearRun(st) {
    st.status = 'idle';
    st.startedAt = null;
    st.accumSec = 0;
    st.extendMin = 0;
    st.finishedAt = null;
    st.help = false;
  }

  function startRun(st, now) {
    st.status = 'running';
    st.startedAt = now;
    st.accumSec = 0;
    st.extendMin = 0;
    st.finishedAt = null;
  }

  /**
   * Apply an action. Mutates `state` in place.
   * Returns null on success, or a string describing why it was rejected.
   */
  function apply(state, action, now) {
    now = now || Date.now();
    var st, i;

    switch (action.type) {
      case 'station/start':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        startRun(st, now);
        if (!state.roundStartedAt) state.roundStartedAt = now;
        break;

      case 'station/pause':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        if (st.status !== 'running') return 'ฐานนี้ไม่ได้กำลังจับเวลา';
        st.accumSec = elapsedSec(st, now);
        st.startedAt = null;
        st.status = 'paused';
        break;

      case 'station/resume':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        if (st.status !== 'paused') return 'ฐานนี้ไม่ได้หยุดพักอยู่';
        st.startedAt = now;
        st.status = 'running';
        break;

      case 'station/finish':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        st.accumSec = elapsedSec(st, now);
        st.startedAt = null;
        st.status = 'done';
        st.finishedAt = now;
        st.help = false;
        break;

      case 'station/reset':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        clearRun(st);
        break;

      case 'station/extend':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        st.extendMin = Math.max(0, st.extendMin + (Number(action.minutes) || 0));
        if (st.status === 'done') {
          // Re-open a station that was closed too early.
          st.status = 'running';
          st.startedAt = now;
          st.finishedAt = null;
        }
        break;

      case 'station/help':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        st.help = !!action.on;
        break;

      case 'station/note':
        st = find(state, action.id);
        if (!st) return 'ไม่พบฐานนี้';
        st.note = String(action.text || '').slice(0, 120);
        break;

      case 'round/startAll':
        for (i = 0; i < state.stations.length; i++) startRun(state.stations[i], now);
        state.roundStartedAt = now;
        break;

      case 'round/stopAll':
        for (i = 0; i < state.stations.length; i++) {
          st = state.stations[i];
          if (st.status === 'running' || st.status === 'paused') {
            st.accumSec = elapsedSec(st, now);
            st.startedAt = null;
            st.status = 'done';
            st.finishedAt = now;
          }
        }
        break;

      case 'round/next':
        state.round += 1;
        state.roundStartedAt = null;
        for (i = 0; i < state.stations.length; i++) {
          clearRun(state.stations[i]);
          state.stations[i].note = '';
        }
        break;

      case 'round/reset':
        state.round = 1;
        state.roundStartedAt = null;
        for (i = 0; i < state.stations.length; i++) {
          clearRun(state.stations[i]);
          state.stations[i].note = '';
        }
        break;

      case 'announce':
        state.announcement = { text: String(action.text || '').slice(0, 200), at: now };
        break;

      case 'config/save': {
        if (typeof action.eventName === 'string') {
          state.eventName = action.eventName.slice(0, 60) || 'ค่ายกิจกรรม';
        }
        if (Array.isArray(action.groups)) {
          state.groups = action.groups
            .map(function (g) { return String(g).trim().slice(0, 40); })
            .filter(Boolean);
        }
        if (Array.isArray(action.stations)) {
          if (!action.stations.length) return 'ต้องมีอย่างน้อย 1 ฐาน';
          var byId = {};
          state.stations.forEach(function (s) { byId[s.id] = s; });
          state.stations = action.stations.map(function (incoming) {
            var kept = incoming.id && byId[incoming.id];
            var next = kept || station('ฐานใหม่', 20);
            next.name = String(incoming.name || next.name).trim().slice(0, 40) || 'ฐานใหม่';
            next.staff = String(incoming.staff || '').trim().slice(0, 40);
            var d = Number(incoming.durationMin);
            next.durationMin = isFinite(d) && d > 0 ? Math.min(600, Math.round(d)) : next.durationMin;
            return next;
          });
        }
        break;
      }

      default:
        return 'ไม่รู้จักคำสั่ง: ' + action.type;
    }

    state.updatedAt = now;
    return null;
  }

  // Firebase Realtime Database hands arrays back as numeric-keyed objects
  // whenever the keys are not a perfect dense sequence. Normalise before use.
  function toArray(value) {
    if (Array.isArray(value)) return value.filter(function (x) { return x != null; });
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .filter(function (k) { return /^\d+$/.test(k); })
        .sort(function (a, b) { return Number(a) - Number(b); })
        .map(function (k) { return value[k]; })
        .filter(function (x) { return x != null; });
    }
    return null;
  }

  // Repair a state object loaded from disk / localStorage / Firebase.
  function migrate(loaded) {
    var base = defaultState();
    if (!loaded || typeof loaded !== 'object') return base;

    var stations = toArray(loaded.stations);
    if (!stations || !stations.length) return base;

    var out = Object.assign(base, loaded);
    out.v = STATE_VERSION;
    out.round = Number(out.round) > 0 ? Math.round(Number(out.round)) : 1;
    out.announcement = out.announcement || { text: '', at: 0 };

    var groups = toArray(loaded.groups);
    out.groups = groups && groups.length ? groups.map(String) : base.groups;

    out.stations = stations.map(function (s) {
      s = s || {};
      var d = station(s.name || 'ฐาน', Number(s.durationMin) > 0 ? Number(s.durationMin) : 20);
      var merged = Object.assign(d, s, { id: s.id || d.id });
      // Firebase drops keys whose value is null, so re-assert the defaults.
      if (merged.startedAt === undefined) merged.startedAt = null;
      if (merged.finishedAt === undefined) merged.finishedAt = null;
      merged.accumSec = Number(merged.accumSec) || 0;
      merged.extendMin = Number(merged.extendMin) || 0;
      merged.help = !!merged.help;
      merged.staff = merged.staff || '';
      merged.note = merged.note || '';
      return merged;
    });
    return out;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    uid: uid,
    station: station,
    defaultState: defaultState,
    migrate: migrate,
    apply: apply,
    find: find,
    elapsedSec: elapsedSec,
    totalSec: totalSec,
    remainingSec: remainingSec,
    groupAt: groupAt
  };
});
