/*! MagicDash kiosk bridge — include from /api/plugins/web-app/sdk.js inside a page shown by the Web app tile.
 *  Everything is optional: a page that never loads this still works; with it, the page can talk to the kiosk.
 *
 *    <script src="/api/plugins/web-app/sdk.js"></script>
 *    MagicDash.ready().then(ctx => { ... });
 *
 *  Promise-returning methods: notify, setAlert, setBackground, requestAttention, releaseAttention, showScreen,
 *  expand, collapse, navigate, back, home, publish, openSettings, activity, kv.get/set/delete/all, fetch, getTopic.
 *  Events (MagicDash.on(name, fn)): ready, context, theme, size, editMode, expanded, visibility, back, topic:<name>.
 *  Properties (after ready): context, theme, size, editMode, locale, expanded, version.
 */
(function () {
  if (window.MagicDash) return;
  var inFrame = window.parent && window.parent !== window;
  var pending = {};
  var seq = 0;
  var listeners = {};
  var readyResolvers = [];
  var api = {
    version: 1,
    connected: false,
    context: {},
    theme: {},
    size: { w: 0, h: 0, width: 0, height: 0 },
    editMode: false,
    locale: 'en',
    expanded: false,
  };

  function emit(name, payload) {
    (listeners[name] || []).slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (e) {
        console.error('[MagicDash] listener error', e);
      }
    });
  }
  function send(type, payload) {
    return new Promise(function (resolve, reject) {
      if (!inFrame) return reject(new Error('Not inside a MagicDash tile'));
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ magicdash: 1, id: id, type: type, payload: payload }, '*');
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error('MagicDash did not answer "' + type + '" (bridge disabled or not a MagicDash tile)'));
        }
      }, 5000);
    });
  }
  function applyTheme(t) {
    if (!t) return;
    var root = document.documentElement;
    Object.keys(t).forEach(function (k) {
      if (typeof t[k] === 'string' || typeof t[k] === 'number') root.style.setProperty('--md-' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), String(t[k]));
    });
    root.setAttribute('data-md-dark', t.dark ? '1' : '0');
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.magicdash !== 1) return;
    if (d.id && pending[d.id]) {
      var p = pending[d.id];
      delete pending[d.id];
      d.ok ? p.resolve(d.result) : p.reject(new Error(d.error || 'MagicDash error'));
      return;
    }
    if (!d.event) return;
    var pl = d.payload;
    switch (d.event) {
      case 'ready':
        api.connected = true;
        api.context = pl.context || {};
        api.theme = pl.theme || {};
        api.size = pl.size || api.size;
        api.editMode = !!pl.editMode;
        api.locale = pl.locale || 'en';
        api.expanded = !!pl.expanded;
        applyTheme(api.theme);
        readyResolvers.splice(0).forEach(function (r) { r(api.context); });
        break;
      case 'context': api.context = pl; break;
      case 'theme': api.theme = pl; applyTheme(pl); break;
      case 'size': api.size = pl; break;
      case 'editMode': api.editMode = !!pl; break;
      case 'expanded': api.expanded = !!pl; break;
      case 'back':
        // Default: browser history. A page that listens for 'back' takes over (return false to suppress the default).
        var handled = (listeners.back || []).some(function (fn) { return fn(pl) !== false; });
        if (!handled) history.back();
        return;
    }
    emit(d.event, pl);
    if (d.event === 'topic' && pl && pl.topic) emit('topic:' + pl.topic, pl.payload);
  });

  api.ready = function () {
    return new Promise(function (resolve) {
      if (api.connected) return resolve(api.context);
      readyResolvers.push(resolve);
      if (inFrame) window.parent.postMessage({ magicdash: 1, type: 'hello', payload: { href: location.href, title: document.title } }, '*');
      else setTimeout(function () { resolve(api.context); }, 0);
    });
  };
  api.on = function (name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    if (name.indexOf('topic:') === 0) send('subscribe', { topic: name.slice(6) }).catch(function () {});
    return function () {
      listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; });
    };
  };
  api.notify = function (message, opts) {
    var o = typeof message === 'string' ? Object.assign({ message: message }, opts || {}) : message;
    return send('notify', o);
  };
  api.setAlert = function (on) { return send('setAlert', { on: on !== false }); };
  api.setBackground = function (css) { return send('setBackground', { css: css || null }); };
  api.requestAttention = function (reason) { return send('requestAttention', { reason: reason }); };
  api.releaseAttention = function () { return send('releaseAttention'); };
  api.showScreen = function (screen) { return send('showScreen', { screen: screen }); };
  api.expand = function () { return send('expand'); };
  api.collapse = function () { return send('collapse'); };
  api.navigate = function (url) { return send('navigate', { url: url }); };
  api.back = function () { return send('back'); };
  api.home = function () { return send('home'); };
  api.publish = function (topic, payload) { return send('publish', { topic: topic, payload: payload }); };
  api.getTopic = function (topic) { return send('getTopic', { topic: topic }); };
  api.openSettings = function () { return send('openSettings'); };
  api.activity = function () { return send('activity'); };
  api.fetch = function (url, init) { return send('fetch', { url: url, method: (init && init.method) || 'GET', body: init && init.body }); };
  api.kv = {
    get: function (key) { return send('kv', { op: 'get', key: key }); },
    set: function (key, value) { return send('kv', { op: 'set', key: key, value: value }); },
    delete: function (key) { return send('kv', { op: 'delete', key: key }); },
    all: function () { return send('kv', { op: 'all' }); },
  };
  // Escape leaves full screen (keyboard focus is inside the frame, so the tile can't see the key itself).
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && api.expanded && inFrame) window.parent.postMessage({ magicdash: 1, type: 'collapse' }, '*');
  });
  // Idle detection: tell the tile the user is active (it can't see clicks inside the frame).
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    var last = 0;
    window.addEventListener(ev, function () {
      var now = Date.now();
      if (now - last > 2000 && inFrame) {
        last = now;
        window.parent.postMessage({ magicdash: 1, type: 'activity' }, '*');
      }
    }, { passive: true });
  });

  window.MagicDash = api;
  if (inFrame) api.ready();
})();
