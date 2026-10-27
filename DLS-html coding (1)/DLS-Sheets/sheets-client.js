/*!
 * dls-client.js  –  BeautyBasket by DLS
 * -----------------------------------------------------------------------------
 * High performance client connecting the frontend directly to the Node.js TypeScript
 * backend (configured via window.DLS_API_URL in config.js).
 * Completely replaces Supabase and Google Apps Script.
 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'dls.session.v1';
  var PHOTO_MAP_KEY = 'dls.photo.urls.v1';
  var BATCH_MAX_OPS = 30;
  var FETCH_TIMEOUT_MS = 150000;

  function apiUrl() {
    var u = global.DLS_API_URL || 'http://localhost:5000/api';
    if (!u || /PASTE|YOUR_/i.test(u)) {
      throw makeError('The DLS Backend URL is not configured. Open config.js and set DLS_API_URL.', 'NOT_CONFIGURED');
    }
    return u;
  }

  function makeError(message, code, extra) {
    var e = { message: message, code: code || 'ERR', details: null, hint: null, name: 'PostgrestError' };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  function safeGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function safeDel(k) { try { global.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------------------
  //  Session handling
  // ---------------------------------------------------------------------------
  var authListeners = [];
  var memorySession = null;

  function loadSession() {
    var raw = safeGet(SESSION_KEY), s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
    if (!s) s = memorySession;
    return s;
  }
  function saveSession(s) {
    memorySession = s;
    if (s) safeSet(SESSION_KEY, JSON.stringify(s)); else safeDel(SESSION_KEY);
  }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function emitAuth(event, session) {
    authListeners.slice().forEach(function (cb) {
      try { cb(event, session); } catch (e) { console.error('auth listener error', e); }
    });
  }
  function isLoginPage() { return /login\.html$/i.test(global.location && global.location.pathname || ''); }

  var refreshing = null;
  function refreshSession() {
    if (refreshing) return refreshing;
    var s = loadSession();
    if (!s) return Promise.resolve({ data: { session: null, user: null }, error: makeError('Auth session missing!', 'session_missing') });
    refreshing = transport.send({ op: 'auth.refresh' }, { token: s.access_token, noBatch: true, noAuthRedirect: true }).then(function (res) {
      refreshing = null;
      if (res.error) {
        if (res.error.status === 401 || res.error.code === 'bad_jwt') { saveSession(null); emitAuth('SIGNED_OUT', null); }
        return { data: { session: null, user: null }, error: res.error };
      }
      saveSession(res.data.session);
      emitAuth('TOKEN_REFRESHED', res.data.session);
      return { data: { session: res.data.session, user: res.data.user }, error: null };
    }, function (err) { refreshing = null; return { data: { session: null, user: null }, error: makeError(String(err && err.message || err), 'NETWORK') }; });
    return refreshing;
  }

  function forceLogout() {
    var had = !!loadSession();
    saveSession(null);
    if (had) emitAuth('SIGNED_OUT', null);
    if (!isLoginPage() && global.location) {
      try { global.location.href = 'login.html'; } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  //  Transport: batches calls made in the same tick into one HTTP request
  // ---------------------------------------------------------------------------
  var transport = {
    queue: [],
    timer: null,
    pendingWrites: 0,

    send: function (op, opts) {
      opts = opts || {};
      var self = this;
      return new Promise(function (resolve, reject) {
        var item = { op: op, resolve: resolve, reject: reject, opts: opts };
        if (opts.noBatch) { self.flushItems([item]); return; }
        self.queue.push(item);
        if (self.queue.length >= BATCH_MAX_OPS) { self.flush(); return; }
        if (!self.timer) self.timer = setTimeout(function () { self.flush(); }, 0);
      });
    },

    flush: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      var items = this.queue; this.queue = [];
      if (items.length) this.flushItems(items);
    },

    flushItems: function (items) {
      var self = this;
      var token = null;
      for (var i = 0; i < items.length; i++) { if (items[i].opts.token) { token = items[i].opts.token; break; } }
      if (!token) { var s = loadSession(); token = s ? s.access_token : null; }
      var isWrite = items.some(function (it) { return it.op.op !== 'poll' && !(it.op.op === 'query' && (it.op.action || 'select') === 'select') && it.op.op !== 'rpc'; });
      var body = items.length === 1 ? Object.assign({}, items[0].op) : { op: 'batch', ops: items.map(function (it) { return it.op; }) };
      if (token) body.token = token;
      var payload = JSON.stringify(body);

      var attempt = 0;
      function once() {
        attempt++;
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : null;
        var url;
        try { url = apiUrl(); } catch (e) { done(null, e); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
        }
        fetch(url, { method: 'POST', headers: headers, body: payload, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
          .then(function (r) { return r.text(); })
          .then(function (txt) {
            if (to) clearTimeout(to);
            var json;
            try { json = JSON.parse(txt); } catch (e) {
              var hint = /<html|<!doctype/i.test(txt) ? 'The web app returned a web page instead of data. Check that the Apps Script deployment is set to "Execute as: Me" and "Who has access: Anyone", and that DLS_API_URL ends with /exec.' : 'Unreadable response from the backend.';
              done(null, makeError(hint, 'BAD_RESPONSE'));
              return;
            }
            done(json, null);
          }, function (err) {
            if (to) clearTimeout(to);
            var msg = (err && err.name === 'AbortError') ? 'The request took too long. Please try again.' : 'Network error – could not reach the DLS Backend server. Check that the Node.js backend is running. (' + (err && err.message || err) + ')';
            if (attempt < 2 && !isWrite) { setTimeout(once, 800); return; }
            done(null, makeError(msg, 'NETWORK'));
          });
      }

      function done(json, err) {
        if (err) { items.forEach(function (it) { it.resolve({ data: null, error: err, count: null }); }); return; }
        // whole-request error (busy / auth)
        if (json && json.error && !json.results) {
          if (json.error.code === 'BUSY' && attempt < 3) { setTimeout(once, 600 * attempt); return; }
          items.forEach(function (it) { it.resolve({ data: null, error: json.error, count: null }); });
          if (json.error.code === 'bad_jwt') { handleBadJwt(items); }
          return;
        }
        var results = json.results ? json.results : [json];
        if (json.bumped) noteBumped(json.bumped);
        var sawBad = false;
        items.forEach(function (it, idx) {
          var r = results[idx] || { error: makeError('No result returned', 'NO_RESULT') };
          if (r.error && r.error.code === 'bad_jwt') sawBad = true;
          it.resolve(r);
        });
        if (sawBad) handleBadJwt(items);
      }
      once();
    }
  };

  function handleBadJwt(items) {
    var skip = items.some(function (it) { return it.opts && it.opts.noAuthRedirect; });
    if (skip) return;
    forceLogout();
  }

  // ---------------------------------------------------------------------------
  //  Query builder (PostgREST-like)
  // ---------------------------------------------------------------------------
  function Builder(table) {
    this.q = { op: 'query', table: table, action: 'select', columns: '*', filters: [], order: [] };
    this._throw = false;
  }
  var B = Builder.prototype;

  B.select = function (columns, opts) {
    this.q.columns = (columns === undefined || columns === null || columns === '') ? '*' : String(columns);
    if (this.q.action !== 'select') { this.q.returning = true; }
    if (opts) { if (opts.count) this.q.count = opts.count; if (opts.head) this.q.head = true; }
    return this;
  };
  B.insert = function (values, opts) { this.q.action = 'insert'; this.q.values = values; if (opts && opts.count) this.q.count = opts.count; return this; };
  B.update = function (values, opts) { this.q.action = 'update'; this.q.values = values; if (opts && opts.count) this.q.count = opts.count; return this; };
  B.delete = function (opts) { this.q.action = 'delete'; if (opts && opts.count) this.q.count = opts.count; return this; };
  B.upsert = function (values, opts) {
    this.q.action = 'upsert'; this.q.values = values;
    if (opts) { if (opts.onConflict) this.q.onConflict = opts.onConflict; if (opts.ignoreDuplicates) this.q.ignoreDuplicates = true; if (opts.count) this.q.count = opts.count; }
    return this;
  };

  function addF(self, c, o, v, n) { self.q.filters.push({ c: c, o: o, v: v, n: !!n }); return self; }
  B.eq = function (c, v) { return addF(this, c, 'eq', v); };
  B.neq = function (c, v) { return addF(this, c, 'neq', v); };
  B.gt = function (c, v) { return addF(this, c, 'gt', v); };
  B.gte = function (c, v) { return addF(this, c, 'gte', v); };
  B.lt = function (c, v) { return addF(this, c, 'lt', v); };
  B.lte = function (c, v) { return addF(this, c, 'lte', v); };
  B.like = function (c, v) { return addF(this, c, 'like', v); };
  B.ilike = function (c, v) { return addF(this, c, 'ilike', v); };
  B.is = function (c, v) { return addF(this, c, 'is', v); };
  B.in = function (c, v) { return addF(this, c, 'in', Array.isArray(v) ? v : Array.from(v || [])); };
  B.contains = function (c, v) { return addF(this, c, 'contains', v); };
  B.not = function (c, op, v) {
    if (op === 'in' && typeof v === 'string') v = v.replace(/^\(|\)$/g, '').split(',');
    return addF(this, c, op, v, true);
  };
  B.or = function (expr) { this.q.filters.push({ o: 'or', e: String(expr) }); return this; };
  B.and = function (expr) { this.q.filters.push({ o: 'and', e: String(expr) }); return this; };
  B.filter = function (c, op, v) {
    if (op === 'in' && typeof v === 'string') v = v.replace(/^\(|\)$/g, '').split(',');
    return addF(this, c, op, v);
  };
  B.match = function (obj) { this.q.filters.push({ o: 'match', v: obj }); return this; };
  B.order = function (c, opts) {
    opts = opts || {};
    var asc = opts.ascending !== false;
    var nf = (opts.nullsFirst === undefined) ? (asc ? false : true) : !!opts.nullsFirst;
    this.q.order.push({ c: c, asc: asc, nf: nf });
    return this;
  };
  B.limit = function (n) { this.q.limit = n; return this; };
  B.range = function (from, to) { this.q.from = from; this.q.to = to; return this; };
  B.single = function () { this.q.single = 'single'; return this; };
  B.maybeSingle = function () { this.q.single = 'maybe'; return this; };
  B.throwOnError = function () { this._throw = true; return this; };
  B.abortSignal = function () { return this; };
  B.returns = function () { return this; };
  B.csv = function () { return this; };

  B.then = function (onFulfilled, onRejected) {
    var self = this;
    var p = transport.send(this.q).then(function (res) {
      var out = shapeResult(res);
      if (self._throw && out.error) { var e = new Error(out.error.message); Object.assign(e, out.error); throw e; }
      if (self.q.action !== 'select') markWrite(self.q.table);
      return out;
    });
    return p.then(onFulfilled, onRejected);
  };
  B.catch = function (fn) { return this.then(undefined, fn); };
  B.finally = function (fn) { return this.then(function (v) { fn && fn(); return v; }, function (e) { fn && fn(); throw e; }); };

  function shapeResult(res) {
    if (res && res.error) {
      var er = res.error;
      return { data: null, error: { message: er.message, code: er.code, details: er.details || null, hint: er.hint || null, status: er.status }, count: null, status: er.status || 400, statusText: 'Error' };
    }
    return { data: res.data === undefined ? null : res.data, error: null, count: res.count === undefined ? null : res.count, status: 200, statusText: 'OK' };
  }

  // rpc builder
  function RpcBuilder(fn, args, opts) { this.op = { op: 'rpc', fn: fn, args: args || {} }; this._single = null; this._throw = false; }
  var R = RpcBuilder.prototype;
  R.range = function (from, to) { this.op.range = [from, to]; return this; };
  R.limit = function (n) { this.op.range = [0, n - 1]; return this; };
  R.single = function () { this._single = 'single'; return this; };
  R.maybeSingle = function () { this._single = 'maybe'; return this; };
  R.throwOnError = function () { this._throw = true; return this; };
  R.order = function () { return this; };
  R.then = function (ok, bad) {
    var self = this;
    return transport.send(this.op).then(function (res) {
      var out = shapeResult(res);
      if (!out.error && self._single) {
        var d = Array.isArray(out.data) ? out.data : [out.data];
        if (d.length === 1) out.data = d[0];
        else if (d.length === 0 && self._single === 'maybe') out.data = null;
        else out = { data: null, error: makeError('JSON object requested, multiple (or no) rows returned', 'PGRST116'), count: null, status: 406 };
      }
      if (self._throw && out.error) { var e = new Error(out.error.message); Object.assign(e, out.error); throw e; }
      return out;
    }).then(ok, bad);
  };
  R.catch = function (fn) { return this.then(undefined, fn); };

  // ---------------------------------------------------------------------------
  //  Auth
  // ---------------------------------------------------------------------------
  function authError(err) {
    return { name: 'AuthApiError', message: err.message, status: err.status || 400, code: err.code };
  }

  var auth = {
    getSession: function () {
      var s = loadSession();
      if (!s) return Promise.resolve({ data: { session: null }, error: null });
      if (s.expires_at && s.expires_at <= nowSec()) { saveSession(null); return Promise.resolve({ data: { session: null }, error: null }); }
      if (s.expires_at && s.expires_at - nowSec() < 3 * 3600) {
        return refreshSession().then(function (r) {
          if (r.error && !r.data.session) {
            var again = loadSession();
            return { data: { session: again || null }, error: null };
          }
          return { data: { session: r.data.session }, error: null };
        });
      }
      return Promise.resolve({ data: { session: s }, error: null });
    },
    getUser: function () {
      var s = loadSession();
      if (!s || (s.expires_at && s.expires_at <= nowSec())) {
        return Promise.resolve({ data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 } });
      }
      return Promise.resolve({ data: { user: s.user }, error: null });
    },
    signInWithPassword: function (cred) {
      return transport.send({ op: 'auth.signIn', email: cred && cred.email, password: cred && cred.password }, { noBatch: true, noAuthRedirect: true, token: '' }).then(function (res) {
        if (res.error) return { data: { user: null, session: null }, error: authError(res.error) };
        saveSession(res.data.session);
        emitAuth('SIGNED_IN', res.data.session);
        return { data: { user: res.data.user, session: res.data.session }, error: null };
      });
    },
    signUp: function (a) {
      a = a || {};
      return transport.send({ op: 'auth.signUp', email: a.email, password: a.password, options: a.options || {} }, { noBatch: true }).then(function (res) {
        if (res.error) return { data: { user: null, session: null }, error: authError(res.error) };
        return { data: { user: res.data.user, session: null }, error: null };
      });
    },
    signOut: function () {
      saveSession(null);
      emitAuth('SIGNED_OUT', null);
      return Promise.resolve({ error: null });
    },
    resetPasswordForEmail: function (email) {
      return transport.send({ op: 'auth.reset', email: email }, { noBatch: true, noAuthRedirect: true, token: '' }).then(function (res) {
        if (res.error) return { data: null, error: authError(res.error) };
        return { data: {}, error: null };
      });
    },
    updateUser: function (attrs) {
      return transport.send({ op: 'auth.update', password: attrs && attrs.password, data: attrs && attrs.data }, { noBatch: true }).then(function (res) {
        if (res.error) return { data: { user: null }, error: authError(res.error) };
        if (res.data.session) { saveSession(res.data.session); emitAuth('USER_UPDATED', res.data.session); }
        return { data: { user: res.data.user }, error: null };
      });
    },
    refreshSession: function () { return refreshSession(); },
    setSession: function (s) { saveSession(s); return Promise.resolve({ data: { session: s, user: s && s.user }, error: null }); },
    onAuthStateChange: function (cb) {
      authListeners.push(cb);
      setTimeout(function () { try { cb('INITIAL_SESSION', loadSession()); } catch (e) { console.error(e); } }, 0);
      return { data: { subscription: { unsubscribe: function () { authListeners = authListeners.filter(function (x) { return x !== cb; }); } } } };
    },
    admin: {
      deleteUser: function () { return Promise.resolve({ data: null, error: makeError('Use the Admin page to delete users.', 'unsupported') }); }
    }
  };

  // ---------------------------------------------------------------------------
  //  Storage (Google Drive)
  // ---------------------------------------------------------------------------
  function photoMap() { var r = safeGet(PHOTO_MAP_KEY); try { return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
  function rememberPhoto(path, url) {
    var m = photoMap(); m[path] = url;
    var keys = Object.keys(m); if (keys.length > 300) delete m[keys[0]];
    safeSet(PHOTO_MAP_KEY, JSON.stringify(m));
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      if (typeof file === 'string') { resolve(btoa(unescape(encodeURIComponent(file)))); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(fr.error || new Error('Could not read file')); };
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.readAsDataURL(file);
    });
  }

  function storageFrom(bucket) {
    return {
      upload: function (path, file, opts) {
        opts = opts || {};
        return fileToBase64(file).then(function (b64) {
          return transport.send({ op: 'storage.upload', bucket: bucket, path: path, base64: b64, contentType: opts.contentType || file.type || 'application/octet-stream', upsert: !!opts.upsert }, { noBatch: true });
        }).then(function (res) {
          if (res.error) return { data: null, error: { message: res.error.message, statusCode: String(res.error.status || 400), error: res.error.code } };
          rememberPhoto(path, res.data.url);
          return { data: { path: res.data.path, id: res.data.id, fullPath: bucket + '/' + res.data.path }, error: null };
        }, function (err) { return { data: null, error: { message: String(err && err.message || err) } }; });
      },
      getPublicUrl: function (path) {
        var u = photoMap()[path];
        return { data: { publicUrl: u || '' } };
      },
      remove: function (paths) {
        return transport.send({ op: 'storage.remove', bucket: bucket, paths: paths }, { noBatch: true }).then(function (res) {
          if (res.error) return { data: null, error: { message: res.error.message } };
          return { data: res.data, error: null };
        });
      },
      list: function (prefix, opts) {
        return transport.send({ op: 'storage.list', bucket: bucket, prefix: prefix || '', limit: (opts && opts.limit) || 100 }).then(function (res) {
          if (res.error) return { data: null, error: { message: res.error.message } };
          return { data: res.data, error: null };
        });
      },
      createSignedUrl: function (path) {
        var u = photoMap()[path];
        return Promise.resolve({ data: { signedUrl: u || '' }, error: null });
      },
      download: function () { return Promise.resolve({ data: null, error: { message: 'download is not supported' } }); }
    };
  }

  var storage = {
    from: storageFrom,
    listBuckets: function () { return Promise.resolve({ data: [{ id: 'bill-photos', name: 'bill-photos', public: true }], error: null }); },
    getBucket: function (n) { return Promise.resolve({ data: { id: n, name: n, public: true }, error: null }); },
    createBucket: function (n) { return Promise.resolve({ data: { name: n }, error: null }); }
  };

  // ---------------------------------------------------------------------------
  //  Realtime (polling of table version counters)
  // ---------------------------------------------------------------------------
  var writeSeq = 0; // bumped by every non-read op; lets callers invalidate local caches
  var RT = { channels: [], baseline: null, timer: null, running: false, lastWrite: {}, inflight: false };

  function noteBumped(bumped) {
    if (!RT.baseline) return;
    Object.keys(bumped).forEach(function (t) {
      var v = bumped[t];
      // our own write: if nobody else wrote in between, keep baseline in sync so we do not echo it back
      if (RT.baseline[t] !== undefined && RT.baseline[t] === v - 1) RT.baseline[t] = v;
    });
  }
  function markWrite(table) { RT.lastWrite[table] = Date.now(); writeSeq++; }

  function pollInterval() { return Math.max(4000, Number(global.DLS_POLL_MS) || 12000); }

  function watchedTables() {
    var set = {};
    RT.channels.forEach(function (ch) { if (ch.active) ch.handlers.forEach(function (h) { set[h.table] = true; }); });
    return Object.keys(set);
  }

  function pollOnce() {
    var tables = watchedTables();
    if (!tables.length || !loadSession() || RT.inflight) return Promise.resolve();
    RT.inflight = true;
    return transport.send({ op: 'poll', tables: tables }, { noBatch: true, noAuthRedirect: true }).then(function (res) {
      RT.inflight = false;
      if (res.error) return;
      var v = res.data.versions || {};
      if (!RT.baseline) { RT.baseline = {}; tables.forEach(function (t) { RT.baseline[t] = v[t]; }); return; }
      tables.forEach(function (t) {
        if (RT.baseline[t] === undefined) { RT.baseline[t] = v[t]; return; }
        if (v[t] !== RT.baseline[t]) {
          RT.baseline[t] = v[t];
          fireTable(t);
        }
      });
    }, function () { RT.inflight = false; });
  }

  function fireTable(t) {
    RT.channels.forEach(function (ch) {
      if (!ch.active) return;
      ch.handlers.forEach(function (h) {
        if (h.table !== t) return;
        try { h.cb({ eventType: 'SYNC', schema: 'public', table: t, new: null, old: null, errors: null, commit_timestamp: new Date().toISOString() }); }
        catch (e) { console.error('realtime handler error', e); }
      });
    });
  }

  function schedulePoll() {
    if (RT.timer) return;
    RT.timer = setInterval(function () {
      if (global.document && global.document.hidden) return;
      pollOnce();
    }, pollInterval());
    if (global.document && !RT.visBound) {
      RT.visBound = true;
      global.document.addEventListener('visibilitychange', function () { if (!global.document.hidden) pollOnce(); });
    }
  }

  function Channel(name) { this.name = name; this.handlers = []; this.active = false; }
  Channel.prototype.on = function (type, filter, cb) {
    if (type === 'postgres_changes' && filter && filter.table) this.handlers.push({ table: filter.table, cb: cb });
    return this;
  };
  Channel.prototype.subscribe = function (statusCb) {
    this.active = true;
    if (RT.channels.indexOf(this) < 0) RT.channels.push(this);
    RT.baseline = null; // re-baseline so that a new subscription does not fire for old changes
    schedulePoll();
    setTimeout(pollOnce, 50);
    if (typeof statusCb === 'function') setTimeout(function () { statusCb('SUBSCRIBED'); }, 0);
    return this;
  };
  Channel.prototype.unsubscribe = function () {
    this.active = false;
    RT.channels = RT.channels.filter(function (c) { return c !== this; }, this);
    return Promise.resolve('ok');
  };

  // ---------------------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------------------
  function createClient() {
    return {
      from: function (t) { return new Builder(t); },
      rpc: function (fn, args) { writeSeq++; return new RpcBuilder(fn, args); },
      auth: auth,
      storage: storage,
      channel: function (name) { return new Channel(name); },
      removeChannel: function (ch) { if (ch && ch.unsubscribe) return ch.unsubscribe(); return Promise.resolve('ok'); },
      removeAllChannels: function () { RT.channels.forEach(function (c) { c.active = false; }); RT.channels = []; return Promise.resolve([]); },
      getChannels: function () { return RT.channels.slice(); },
      realtime: { setAuth: function () {}, disconnect: function () {} },
      functions: { invoke: function () { return Promise.resolve({ data: null, error: makeError('Edge functions are not available', 'unsupported') }); } }
    };
  }

  global.supabase = { createClient: createClient };
  global.DLSBackend = {
    ping: function () { return transport.send({ op: 'ping' }, { noBatch: true, noAuthRedirect: true, token: '' }); },
    refreshNow: pollOnce,
    writeSeq: function () { return writeSeq; },
    getSession: loadSession,
    version: '1.0.0'
  };
})(typeof window !== 'undefined' ? window : globalThis);
