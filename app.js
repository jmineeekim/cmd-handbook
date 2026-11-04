/* 명령어 핸드북 웹앱 (PWA) */
(function () {
  'use strict';

  var DATA_REPO = 'https://raw.githubusercontent.com/jmineeekim/cmd-handbook-data/main/';
  var REMOTE_VERSION = DATA_REPO + 'version.json';
  var REMOTE_BUNDLE = DATA_REPO + 'dist/handbook.json';
  var LOCAL_BUNDLE = 'data/handbook.json';
  var DATA_CACHE = 'ch-data-v1';
  var DATA_KEY = 'handbook.json';

  var OS = {
    linux: { label: 'Linux 공통' },
    rhel: { label: 'RHEL·Rocky' },
    debian: { label: 'Ubuntu·Debian' },
    windows: { label: 'Windows' }
  };
  var FILTERS = [
    { id: 'all', label: '전체' },
    { id: 'rhel', label: 'RHEL·Rocky' },
    { id: 'debian', label: 'Ubuntu·Debian' },
    { id: 'windows', label: 'Windows' }
  ];
  var LEVEL = { basic: '기본', frequent: '자주', critical: '드물지만 중요' };
  var LEVEL_ORDER = { basic: 0, frequent: 1, critical: 2 };
  var KIND_LABEL = { file: '설정·로그 파일', gui: 'GUI 도구' };
  var SHELL_LABEL = { sh: 'Shell', cmd: 'CMD', powershell: 'PowerShell' };

  /* ---------- storage ---------- */
  function load(key, def) {
    try { var v = localStorage.getItem('ch.' + key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem('ch.' + key, JSON.stringify(val)); } catch (e) {}
  }
  var settings = Object.assign({ env: 'all', theme: 'system', font: 14 }, load('settings', {}));
  var favorites = load('favorites', []);
  var recents = load('recents', []);
  var recentSearches = load('recentSearches', []);
  var lastCheck = load('lastCheck', null);

  /* ---------- data ---------- */
  var DB = null; // { categories, commands, byId, byTask, catById, taskById, dataVersion }

  function index(bundle) {
    var d = {
      dataVersion: bundle.dataVersion,
      generatedAt: bundle.generatedAt,
      categories: bundle.categories,
      commands: bundle.commands,
      byId: {}, byTask: {}, catById: {}, taskById: {}
    };
    bundle.categories.forEach(function (c) {
      d.catById[c.id] = c;
      c.tasks.forEach(function (t, i) { d.taskById[t.id] = { name: t.name, cat: c.id, order: i }; });
    });
    bundle.commands.forEach(function (c) {
      d.byId[c.id] = c;
      (d.byTask[c.task] = d.byTask[c.task] || []).push(c);
      c._search = [
        c.name, (c.aliases || []).join(' '), (c.keywords || []).join(' '), c.summary,
        d.taskById[c.task] ? d.taskById[c.task].name : '', d.catById[c.category] ? d.catById[c.category].name : ''
      ].join(' ').toLowerCase();
    });
    return d;
  }

  function cacheGet() {
    if (!('caches' in window)) return Promise.resolve(null);
    return caches.open(DATA_CACHE).then(function (c) { return c.match(DATA_KEY); })
      .then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
  }
  function cachePut(text) {
    if (!('caches' in window)) return Promise.resolve();
    return caches.open(DATA_CACHE).then(function (c) {
      return c.put(DATA_KEY, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () {});
  }
  function sha256Hex(buf) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function loadInitial() {
    return cacheGet().then(function (cached) {
      if (cached && cached.commands) return cached;
      return fetch(LOCAL_BUNDLE).then(function (r) { if (!r.ok) throw new Error('local'); return r.json(); })
        .catch(function () { return fetch(REMOTE_BUNDLE).then(function (r) { return r.json(); }); });
    });
  }

  // 원격 version.json 을 확인하고 새 데이터가 있으면 받아서 교체
  function checkUpdate(manual) {
    return fetch(REMOTE_VERSION + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('version'); return r.json(); })
      .then(function (v) {
        lastCheck = new Date().toISOString(); save('lastCheck', lastCheck);
        if (DB && v.dataVersion === DB.dataVersion) return { updated: false };
        return fetch(REMOTE_BUNDLE + '?v=' + encodeURIComponent(v.dataVersion), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('bundle'); return r.arrayBuffer(); })
          .then(function (buf) {
            return sha256Hex(buf).then(function (hex) {
              if (hex && v.sha256 && hex !== v.sha256) throw new Error('checksum');
              var text = new TextDecoder('utf-8').decode(buf);
              var bundle = JSON.parse(text);
              DB = index(bundle);
              return cachePut(text).then(function () { return { updated: true, version: v.dataVersion }; });
            });
          });
      })
      .then(function (res) {
        if (res.updated) { toast('새 데이터로 업데이트했어요 · ' + res.version); route(); }
        else if (manual) { toast('최신 데이터예요'); }
        if (manual) route();
        return res;
      })
      .catch(function () {
        if (manual) toast('업데이트를 확인하지 못했어요. 저장된 데이터로 동작해요');
        return { updated: false, error: true };
      });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  var PH = /\{\{([A-Z0-9_]+)\}\}/g;
  function phHtml(s) {
    var out = '', last = 0, m;
    PH.lastIndex = 0;
    while ((m = PH.exec(s))) {
      out += esc(s.slice(last, m.index)) + '<span class="ph">' + esc(m[1]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }
  function phPlain(s) { return String(s).replace(PH, '$1'); }
  function group(c) {
    var p = c.platforms;
    if (p.indexOf('rhel') > -1 && p.indexOf('debian') > -1) return 'linux';
    return p[0];
  }
  function osBadge(c) {
    var g = group(c);
    if (g === 'linux' && c.platforms.indexOf('windows') > -1) return '<span class="badge linux">Linux·Windows</span>';
    return '<span class="badge ' + g + '">' + esc(OS[g].label) + '</span>';
  }
  function visible(c, f) { return f === 'all' || c.platforms.indexOf(f) > -1; }
  function sortCmds(a, b) {
    var ta = DB.taskById[a.task], tb = DB.taskById[b.task];
    return (ta.order - tb.order) || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.name.localeCompare(b.name);
  }
  function icon(name) {
    var p = {
      back: '<path d="m15 18-6-6 6-6"/>',
      chev: '<path d="m9 6 6 6-6 6"/>',
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      x: '<path d="M18 6 6 18M6 6l12 12"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'
    }[name];
    return '<svg aria-hidden="true" viewBox="0 0 24 24">' + p + '</svg>';
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function chips(cur) {
    return '<div class="chips" role="group" aria-label="OS 필터">' + FILTERS.map(function (f) {
      return '<button class="chip" data-act="env" data-v="' + f.id + '" aria-pressed="' + (cur === f.id) + '">' + esc(f.label) + '</button>';
    }).join('') + '</div>';
  }
  function topBar(title, sub, right) {
    return '<header class="top"><button class="icon-btn" data-act="back" aria-label="뒤로">' + icon('back') + '</button>' +
      '<div style="flex:1;min-width:0"><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' + (right || '') + '</header>';
  }
  function cmdRow(c, extra) {
    return '<a class="row" href="#/cmd/' + encodeURIComponent(c.id) + '">' +
      '<span class="dot ' + c.level + '" role="img" aria-label="중요도 ' + LEVEL[c.level] + '"></span>' +
      '<span class="body"><span class="line1"><span class="name">' + esc(c.name) + '</span>' + osBadge(c) + '</span>' +
      (extra || '<span class="desc">' + esc(c.summary) + '</span>') + '</span></a>';
  }
  function repsFor(cat, f) {
    var list = DB.commands.filter(function (c) { return c.category === cat.id && c.kind === 'command' && visible(c, f); });
    list.sort(function (a, b) { return (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || sortCmds(a, b); });
    var seen = {}, out = [];
    list.forEach(function (c) { if (!seen[c.name] && out.length < 4) { seen[c.name] = 1; out.push(c.name); } });
    return out;
  }

  /* ---------- views ---------- */
  function viewHome() {
    var f = settings.env;
    var favs = favorites.map(function (id) { return DB.byId[id]; }).filter(Boolean).slice(0, 8);
    var recs = recents.map(function (id) { return DB.byId[id]; }).filter(Boolean).slice(0, 8);
    var quick = '';
    if (favs.length || recs.length) {
      quick = '<section class="section"><div class="section-head"><h2>즐겨찾기 · 최근 본</h2></div><div class="pills">' +
        favs.map(function (c) { return '<a class="pill" href="#/cmd/' + encodeURIComponent(c.id) + '">★ ' + esc(c.name) + '</a>'; }).join('') +
        recs.filter(function (c) { return favorites.indexOf(c.id) < 0; }).slice(0, 6).map(function (c) {
          return '<a class="pill" href="#/cmd/' + encodeURIComponent(c.id) + '">' + esc(c.name) + '</a>';
        }).join('') + '</div></section>';
    }
    var cats = DB.categories.map(function (cat) {
      var n = DB.commands.filter(function (c) { return c.category === cat.id && visible(c, f); }).length;
      if (!n) return '';
      return '<a class="cat" href="#/cat/' + cat.id + '"><span class="body"><span class="title"><b>' + esc(cat.name) + '</b><span>' + n + '개</span></span>' +
        '<span class="reps">' + esc(repsFor(cat, f).join(' · ')) + '</span></span><span class="chev">' + icon('chev') + '</span></a>';
    }).join('');
    var hint = { all: '모든 OS', rhel: 'RHEL·Rocky 기준', debian: 'Ubuntu·Debian 기준', windows: 'Windows 기준' }[f];
    return '<header class="home-head"><div><div class="brand">$ cmd-handbook</div><h1>명령어 핸드북</h1></div>' +
      '<a class="icon-btn boxed" href="#/settings" aria-label="설정">' + icon('gear') + '</a></header>' +
      '<a class="searchbox" href="#/search">' + icon('search') + '<span>명령어, 기능, 옵션 검색 (예: 포트, 용량)</span></a>' +
      chips(f) + quick +
      '<section class="section"><div class="section-head"><h2>카테고리</h2><span class="hint">' + esc(hint) + '</span></div>' + cats + '</section>' +
      '<p class="note" style="text-align:center;margin-top:20px">명령어 ' + DB.commands.length + '개 · 데이터 ' + esc(DB.dataVersion) + '</p>';
  }

  function viewCategory(id) {
    var cat = DB.catById[id];
    if (!cat) return viewNotFound();
    var f = settings.env;
    var groups = cat.tasks.map(function (t) {
      var list = (DB.byTask[t.id] || []).filter(function (c) { return visible(c, f); }).sort(sortCmds);
      if (!list.length) return '';
      return '<h2 class="group-title">' + esc(t.name) + '</h2><div class="list">' + list.map(function (c) { return cmdRow(c); }).join('') + '</div>';
    }).join('');
    var n = DB.commands.filter(function (c) { return c.category === id && visible(c, f); }).length;
    return topBar(cat.name, '명령어 ' + n + '개', '<a class="icon-btn" href="#/search" aria-label="검색">' + icon('search') + '</a>') +
      chips(f) +
      '<div class="legend"><span><i class="dot basic"></i>기본</span><span><i class="dot frequent"></i>자주</span><span><i class="dot critical"></i>드물지만 중요</span></div>' +
      (groups || '<div class="empty">이 OS에 해당하는 명령어가 없어요</div>');
  }

  function search(q, f) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var res = [];
    DB.commands.forEach(function (c) {
      if (!visible(c, f)) return;
      var score = 0, hit = '';
      var name = c.name.toLowerCase();
      var ok = terms.every(function (t) {
        var s = 0;
        if (name === t) s = 100;
        else if (name.indexOf(t) === 0) s = 70;
        else if (name.indexOf(t) > -1) s = 45;
        else if ((c.aliases || []).some(function (a) { return a.toLowerCase().indexOf(t) > -1; })) s = 40;
        else if (c._search.indexOf(t) > -1) s = 25;
        else {
          var o = c.options.filter(function (o) { return (o.flag + ' ' + o.desc).toLowerCase().indexOf(t) > -1; })[0];
          var gi = null;
          (c.commandGroups || []).some(function (g) { return g.items.some(function (it) { if (((it.cmd || '') + ' ' + (it.left || '') + ' ' + (it.right || '') + ' ' + it.desc).toLowerCase().indexOf(t) > -1) { gi = it; return true; } }); });
          if (o) { s = 12; hit = hit || phPlain(o.flag) + '  ' + o.desc; }
          else if (gi) { s = 14; hit = hit || phPlain(gi.cmd || (gi.left + ' / ' + gi.right)) + '  ' + gi.desc; }
          else {
            var e = c.examples.filter(function (e) { return (e.title + ' ' + (e.command || '') + ' ' + (e.steps || []).map(function (s) { return s.cmd + ' ' + s.desc; }).join(' ')).toLowerCase().indexOf(t) > -1; })[0];
            if (e) { s = 8; hit = hit || e.title; }
          }
        }
        score += s;
        return s > 0;
      });
      if (ok) res.push({ c: c, score: score - LEVEL_ORDER[c.level], hit: hit });
    });
    res.sort(function (a, b) { return b.score - a.score || a.c.name.localeCompare(b.c.name); });
    return res;
  }

  function viewSearch(q) {
    var f = settings.env;
    var html = '<header class="top"><button class="icon-btn" data-act="back" aria-label="뒤로">' + icon('back') + '</button>' +
      '<label class="searchbox" style="flex:1;margin-top:0">' + icon('search') + '<span class="sr">명령어 검색</span>' +
      '<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="명령어, 기능, 옵션 검색" value="' + esc(q) + '">' +
      '</label></header>' + chips(f) + '<div id="results">' + searchResults(q) + '</div>';
    return html;
  }
  function searchResults(q) {
    var f = settings.env;
    if (!q.trim()) {
      var rs = recentSearches.length ? '<section class="section"><div class="section-head"><h2>최근 검색</h2><button class="chip small" data-act="clear-searches">지우기</button></div><div class="pills">' +
        recentSearches.map(function (s) { return '<button class="pill" data-act="q" data-v="' + esc(s) + '" style="font-family:var(--sans);cursor:pointer">' + esc(s) + '</button>'; }).join('') + '</div></section>' : '';
      var tips = ['포트', '용량', '방화벽', '로그', '서비스', '인증서', 'LVM', '시간 동기화', 'tar', 'Get-'];
      return rs + '<section class="section"><div class="section-head"><h2>이렇게 찾아보세요</h2></div><div class="pills">' +
        tips.map(function (s) { return '<button class="pill" data-act="q" data-v="' + esc(s) + '" style="font-family:var(--sans);cursor:pointer">' + esc(s) + '</button>'; }).join('') +
        '</div><p class="note">명령어 이름, 한글 기능명, 옵션, 예시 내용까지 찾아요. 여러 단어는 모두 포함된 결과만 보여줘요.</p></section>';
    }
    var res = search(q, f);
    if (!res.length) return '<div class="empty">\'' + esc(q) + '\' 결과가 없어요' + (f !== 'all' ? '<br><button class="chip small" data-act="env" data-v="all" style="margin-top:12px">전체 OS에서 찾기</button>' : '') + '</div>';
    return '<p class="note" style="margin-top:12px">\'' + esc(q) + '\' 결과 ' + res.length + '개</p><div class="list" style="margin-top:8px">' +
      res.slice(0, 80).map(function (r) {
        var c = r.c, t = DB.taskById[c.task];
        var extra = '<span class="path">' + esc(DB.catById[c.category].name) + ' › ' + esc(t.name) + '</span>' +
          (r.hit ? '<span class="hit">' + esc(r.hit) + '</span>' : '<span class="desc">' + esc(c.summary) + '</span>');
        return cmdRow(c, extra);
      }).join('') + '</div>';
  }

  function viewDetail(id) {
    var c = DB.byId[id];
    if (!c) return viewNotFound();
    recents = [id].concat(recents.filter(function (x) { return x !== id; })).slice(0, 20); save('recents', recents);
    var fav = favorites.indexOf(id) > -1;
    var task = DB.taskById[c.task], cat = DB.catById[c.category];
    var b = [osBadge(c), '<span class="badge lv-' + c.level + '">● ' + LEVEL[c.level] + '</span>'];
    b.push('<span class="badge neutral">' + esc(c.kind === 'command' ? SHELL_LABEL[c.shell] : KIND_LABEL[c.kind]) + '</span>');
    if (c.requiresAdmin) b.push('<span class="badge warn">관리자 권한</span>');
    if (c.risk === 'destructive') b.push('<span class="badge danger">⚠ 위험</span>');
    else if (c.risk === 'caution') b.push('<span class="badge warn">주의</span>');
    var inst = c.install || {};
    var envInst = settings.env !== 'all' && inst[settings.env];
    if (envInst && !envInst.preinstalled) b.push('<span class="badge neutral">별도 설치</span>');

    var hasPh = c.examples.some(function (e) { return /\{\{/.test(e.command || '') || (e.steps || []).some(function (s) { return /\{\{/.test(s.cmd); }); });
    var ex = c.examples.map(function (e, i) {
      var plats = e.platforms && e.platforms.length < c.platforms.length ? e.platforms.map(function (p) { return '<span class="badge ' + p + '">' + esc(OS[p].label) + '</span>'; }).join('') : '';
      var body = e.steps ? '<ol class="steps">' + e.steps.map(function (s, j) {
          return '<li><span class="step-desc">' + esc(s.desc) + '</span><div class="code"><pre>' + (s.prompt ? '<span class="prompt">' + esc(s.prompt) + ' </span>' : '') + phHtml(s.cmd) + '</pre>' +
            '<button class="copy" data-act="copy" data-i="' + i + '" data-s="' + j + '" aria-label="명령어 복사">' + icon('copy') + '</button></div></li>';
        }).join('') + '</ol>'
        : '<div class="code"><pre>' + phHtml(e.command) + '</pre><button class="copy" data-act="copy" data-i="' + i + '" aria-label="명령어 복사">' + icon('copy') + '</button></div>';
      return '<div class="ex"><div class="ex-title">' + esc(e.title) + plats + '</div>' + body +
        (e.output ? '<div class="code out" style="margin-top:6px"><pre>' + esc(e.output) + '</pre></div>' : '') +
        (e.note ? '<p class="ex-note">↳ ' + esc(e.note) + '</p>' : '') + '</div>';
    }).join('');

    var GT = { interactive: '안에서 쓰는 명령', subcommand: '서브 명령', keys: '단축키', directive: '설정 항목', action: '자주 하는 작업' };
    var SIDE = { remote: ['서버 쪽', 'side-remote'], local: ['내 PC 쪽', 'side-local'], both: ['공통', 'side-both'], download: ['⬇ 서버→내 PC', 'side-remote'], upload: ['⬆ 내 PC→서버', 'side-local'] };
    var groups = (c.commandGroups || []).map(function (g, gi) {
      var label = g.type === 'interactive' && g.prompt ? g.prompt + ' ' + GT[g.type] : GT[g.type];
      return '<section class="section"><div class="section-head"><h2>' + esc(g.title) + '</h2><span class="hint">' + esc(label) + '</span></div>' +
        (g.note ? '<p class="group-note">' + esc(g.note) + '</p>' : '') +
        (g.columns ? '<div class="cmp"><div class="cmp-head"><span>' + esc(g.columns[0]) + '</span><span>' + esc(g.columns[1]) + '</span></div>' +
          g.items.map(function (it) {
            return '<div class="cmp-row"><div class="cmp-desc">' + esc(it.desc) + '</div><div class="cmp-cells"><code class="c-l">' + phHtml(it.left) + '</code><code class="c-r">' + phHtml(it.right) + '</code></div>' +
              (it.note ? '<div class="cmp-note">' + esc(it.note) + '</div>' : '') + '</div>';
          }).join('') + '</div></section>' :
        '<div class="opts">' + g.items.map(function (it, ii) {
          var side = it.side ? '<span class="badge ' + SIDE[it.side][1] + '">' + SIDE[it.side][0] + '</span>' : '';
          return '<div class="opt gitem"><div class="gline"><code>' + phHtml(it.cmd) + '</code>' + side + '</div><span>' + esc(it.desc) + (it.note ? ' · ' + esc(it.note) : '') + '</span></div>';
        }).join('') + '</div></section>');
    }).join('');

    var opts = c.options.length ? '<section class="section"><div class="section-head"><h2>주요 옵션</h2></div><div class="opts">' +
      c.options.map(function (o) { return '<div class="opt"><code>' + phHtml(o.flag) + '</code><span>' + esc(o.desc) + '</span></div>'; }).join('') + '</div>' +
      '<div class="code syntax"><pre>' + c.syntax.map(phHtml).join('\n') + '</pre></div></section>'
      : '<section class="section"><div class="section-head"><h2>문법</h2></div><div class="code"><pre>' + c.syntax.map(phHtml).join('\n') + '</pre></div></section>';

    var cautions = c.cautions.length ? '<section class="section"><div class="callout"><h2>주의사항</h2><ul>' +
      c.cautions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></section>' : '';

    var notes = Object.keys(c.platformNotes || {});
    var notesHtml = notes.length ? '<section class="section"><div class="section-head"><h2>OS별 차이</h2></div><ul class="info">' +
      notes.map(function (k) { return '<li><b>' + esc(OS[k].label) + '</b>' + esc(c.platformNotes[k]) + '</li>'; }).join('') + '</ul></section>' : '';

    var instKeys = Object.keys(inst);
    var instHtml = instKeys.length ? '<section class="section"><div class="section-head"><h2>설치 정보</h2></div><ul class="info">' +
      instKeys.map(function (k) {
        var v = inst[k];
        return '<li><b>' + esc(OS[k].label) + '</b>' + (v.package ? '<code>' + esc(v.package) + '</code> · ' : '') +
          (v.preinstalled ? '기본 설치' : '별도 설치 필요') + (v.note ? '<br>' + esc(v.note) : '') + '</li>';
      }).join('') + '</ul></section>' : '';

    var same = (DB.byTask[c.task] || []).filter(function (o) { return o.id !== c.id; }).sort(sortCmds);
    var sameHtml = same.length ? '<section class="section"><div class="section-head"><h2>같은 기능, 다른 명령어</h2><span class="hint">' + esc(task.name) + '</span></div><div class="list">' +
      same.map(function (o) { return cmdRow(o); }).join('') + '</div></section>' : '';

    var rel = (c.related || []).map(function (r) { return DB.byId[r]; }).filter(Boolean);
    var relHtml = rel.length ? '<section class="section"><div class="section-head"><h2>관련 명령어</h2></div><div class="pills">' +
      rel.map(function (o) { return '<a class="pill" href="#/cmd/' + encodeURIComponent(o.id) + '">' + esc(o.name) + '</a>'; }).join('') + '</div></section>' : '';

    return topBar(cat.name + ' › ' + task.name, '', '<button class="icon-btn boxed" data-act="fav" aria-pressed="' + fav + '" aria-label="' + (fav ? '즐겨찾기 해제' : '즐겨찾기 추가') + '" style="color:' + (fav ? 'var(--warn-title)' : 'var(--muted)') + '">' +
      icon('star').replace('fill="none"', '').replace('<svg', '<svg style="fill:' + (fav ? 'currentColor' : 'none') + '"') + '</button>') +
      '<h1 class="d-name">' + esc(c.name) + '</h1>' +
      '<div class="d-badges">' + b.join('') + '</div>' +
      '<p class="d-desc">' + esc(c.description) + '</p>' +
      (c.aliases && c.aliases.length ? '<p class="d-aliases">다른 이름: ' + c.aliases.map(function (a) { return '<code>' + esc(a) + '</code>'; }).join(', ') + '</p>' : '') +
      groups + '<section class="section"><div class="section-head"><h2>실무 예시</h2>' +
      (hasPh ? '<span class="ph-hint"><span class="ph">값</span> 은 바꿔 쓸 부분</span>' : '') + '</div>' + ex + '</section>' +
      opts + cautions + notesHtml + instHtml + sameHtml + relHtml +
      (c.help ? '<p class="help">도움말: <code>' + esc(c.help) + '</code></p>' : '');
  }

  function viewFavorites() {
    var list = favorites.map(function (id) { return DB.byId[id]; }).filter(Boolean);
    var rec = recents.map(function (id) { return DB.byId[id]; }).filter(Boolean).slice(0, 15);
    return '<header class="top" style="padding-top:calc(20px + env(safe-area-inset-top))"><h1>즐겨찾기</h1></header>' +
      (list.length ? '<div class="list" style="margin-top:12px">' + list.map(function (c) { return cmdRow(c); }).join('') + '</div>'
        : '<div class="empty">명령어 상세 화면에서 ★ 를 누르면 여기에 모여요</div>') +
      (rec.length ? '<h2 class="group-title">최근 본 명령어</h2><div class="list">' + rec.map(function (c) { return cmdRow(c); }).join('') + '</div>' : '');
  }

  function viewSettings() {
    var envs = [
      { id: 'all', label: '전체 보기' }, { id: 'rhel', label: 'RHEL · Rocky' },
      { id: 'debian', label: 'Ubuntu · Debian' }, { id: 'windows', label: 'Windows' }
    ];
    var themes = [{ id: 'dark', label: '다크' }, { id: 'light', label: '라이트' }, { id: 'system', label: '시스템' }];
    var when = lastCheck ? new Date(lastCheck).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '확인 전';
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return '<header class="top" style="padding-top:calc(20px + env(safe-area-inset-top))"><h1>설정</h1></header>' +
      '<section class="section"><div class="section-head"><h2>내 작업 환경</h2></div>' +
      '<div class="list" role="radiogroup" aria-label="기본 OS">' + envs.map(function (e) {
        return '<button class="setting-row radio-row" role="radio" aria-checked="' + (settings.env === e.id) + '" data-act="env" data-v="' + e.id + '"><span>' + esc(e.label) + '</span><span class="radio"></span></button>';
      }).join('') + '</div><p class="note">홈·카테고리·검색에 기본으로 적용할 OS예요. 각 화면 위쪽 버튼으로도 바꿀 수 있어요.</p></section>' +
      '<section class="section"><div class="section-head"><h2>화면</h2></div><div class="list">' +
      '<div class="setting-row"><span>테마</span><span class="seg">' + themes.map(function (t) {
        return '<button data-act="theme" data-v="' + t.id + '" aria-pressed="' + (settings.theme === t.id) + '">' + t.label + '</button>';
      }).join('') + '</span></div>' +
      '<div class="setting-row"><span>명령어 글자 크기</span><span class="stepper"><button data-act="font" data-v="-1" aria-label="글자 작게">−</button><output>' + settings.font + '</output><button data-act="font" data-v="1" aria-label="글자 크게">+</button></span></div>' +
      '<div style="padding:0 14px 14px"><div class="code"><pre>firewall-cmd --add-port=<span class="ph">PORT</span>/tcp</pre></div></div>' +
      '</div></section>' +
      '<section class="section"><div class="section-head"><h2>명령어 데이터</h2></div><div class="list">' +
      '<div class="kv"><span>데이터 버전</span><span>' + esc(DB.dataVersion) + '</span></div>' +
      '<div class="kv"><span>명령어 수</span><span>' + DB.commands.length + '개</span></div>' +
      '<div class="kv"><span>마지막 확인</span><span>' + esc(when) + '</span></div>' +
      '<div class="kv"><span>출처</span><span><a href="https://github.com/jmineeekim/cmd-handbook-data" target="_blank" rel="noopener">GitHub · cmd-handbook-data</a></span></div>' +
      '<div style="padding:12px 14px"><button class="btn" data-act="update">지금 업데이트 확인</button></div></div>' +
      '<p class="note">앱을 열 때 새 데이터가 있는지 자동으로 확인해요. 인터넷이 없으면 저장된 데이터로 계속 동작해요.</p></section>' +
      (standalone ? '' : '<section class="section"><div class="section-head"><h2>홈 화면에 추가</h2></div><ul class="info">' +
        '<li><b>Android</b>Chrome 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"</li>' +
        '<li><b>iPhone</b>Safari 공유 버튼 → "홈 화면에 추가"</li></ul></section>') +
      '<p class="note" style="text-align:center;margin-top:24px">실제 서버에 적용하기 전에 대상 OS 버전과 정책을 꼭 확인하세요.</p>';
  }

  function viewNotFound() {
    return topBar('찾을 수 없음') + '<div class="empty">요청한 항목이 없어요. <a href="#/" style="color:var(--accent)">홈으로</a></div>';
  }

  /* ---------- router ---------- */
  var current = { name: '', arg: '' };
  function parse() {
    var h = location.hash.replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var path = qi > -1 ? h.slice(0, qi) : h;
    var query = qi > -1 ? h.slice(qi + 1) : '';
    var parts = path.split('/');
    var params = {};
    query.split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } });
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : '', params: params };
  }
  function route(keepScroll) {
    if (!DB) return;
    var r = parse();
    var view = document.getElementById('view');
    var sameView = current.name === r.name && current.arg === r.arg;
    var y = window.scrollY;
    var html;
    switch (r.name) {
      case 'cat': html = viewCategory(r.arg); break;
      case 'cmd': html = viewDetail(r.arg); break;
      case 'search': html = viewSearch(r.params.q || ''); break;
      case 'favorites': html = viewFavorites(); break;
      case 'settings': html = viewSettings(); break;
      case 'home': html = viewHome(); break;
      default: html = viewNotFound();
    }
    view.innerHTML = html;
    var tab = { home: 'home', cat: 'home', cmd: 'home', search: 'search', favorites: 'favorites', settings: 'settings' }[r.name];
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = ({ cmd: DB.byId[r.arg] ? DB.byId[r.arg].name + ' · ' : '', cat: DB.catById[r.arg] ? DB.catById[r.arg].name + ' · ' : '' }[r.name] || '') + '명령어 핸드북';
    if (sameView || keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    current = r;
    if (r.name === 'search') {
      var q = document.getElementById('q');
      if (q && !sameView && !(r.params.q)) setTimeout(function () { q.focus(); }, 50);
    }
  }

  /* ---------- events ---------- */
  var searchTimer;
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    clearTimeout(searchTimer);
    var v = e.target.value;
    searchTimer = setTimeout(function () {
      document.getElementById('results').innerHTML = searchResults(v);
      history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
      current = parse();
    }, 120);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'q' && e.key === 'Enter') { rememberSearch(e.target.value); e.target.blur(); }
  });
  document.addEventListener('focusout', function (e) {
    if (e.target.id === 'q') rememberSearch(e.target.value);
  });
  function rememberSearch(v) {
    v = (v || '').trim();
    if (!v) return;
    recentSearches = [v].concat(recentSearches.filter(function (x) { return x !== v; })).slice(0, 8);
    save('recentSearches', recentSearches);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) {
      var link = e.target.closest('#results a.row');
      if (link) { var q = document.getElementById('q'); if (q) rememberSearch(q.value); }
      return;
    }
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    switch (act) {
      case 'back':
        if (navDepth > 0) {
          var before = location.hash; goingBack = true; history.back();
          setTimeout(function () { if (location.hash === before) { goingBack = false; location.hash = '#/'; } }, 400);
        } else location.hash = '#/';
        break;
      case 'env':
        settings.env = v; save('settings', settings);
        if (current.name === 'search') {
          Array.prototype.forEach.call(document.querySelectorAll('.chip[data-act="env"]'), function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === v); });
          var q = document.getElementById('q');
          document.getElementById('results').innerHTML = searchResults(q ? q.value : '');
        } else route(true);
        break;
      case 'q':
        var input = document.getElementById('q');
        input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); rememberSearch(v);
        break;
      case 'clear-searches':
        recentSearches = []; save('recentSearches', recentSearches); route(true);
        break;
      case 'fav':
        var id = current.arg, i = favorites.indexOf(id);
        if (i > -1) { favorites.splice(i, 1); toast('즐겨찾기에서 뺐어요'); } else { favorites.unshift(id); toast('즐겨찾기에 추가했어요'); }
        save('favorites', favorites); route(true);
        break;
      case 'copy':
        var cmd = DB.byId[current.arg];
        var ex = cmd && cmd.examples[+el.getAttribute('data-i')];
        var raw = ex && (el.hasAttribute('data-s') ? ex.steps[+el.getAttribute('data-s')].cmd : ex.command);
        if (raw) copyText(phPlain(raw), /\{\{/.test(raw));
        break;
      case 'theme':
        settings.theme = v; save('settings', settings);
        if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
        updateThemeColor(); route(true);
        break;
      case 'font':
        settings.font = Math.max(11, Math.min(20, settings.font + (+v))); save('settings', settings);
        document.documentElement.style.setProperty('--code-size', settings.font + 'px'); route(true);
        break;
      case 'update':
        el.disabled = true; el.textContent = '확인하는 중…';
        checkUpdate(true);
        break;
    }
  });

  function copyText(text, hasPh) {
    var done = function () { toast(hasPh ? '복사했어요 · 강조된 값을 바꿔서 쓰세요' : '복사했어요'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) ? done() : toast('복사하지 못했어요'); });
    } else { fallbackCopy(text) ? done() : toast('복사하지 못했어요'); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); return ok;
  }
  function updateThemeColor() {
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    var m = document.querySelector('meta[name="theme-color"]'); if (m && bg) m.setAttribute('content', bg);
  }

  // 앱 안에서 이동한 횟수 (뒤로 버튼이 앱 밖으로 나가지 않도록)
  var navDepth = 0, goingBack = false;
  window.addEventListener('hashchange', function () {
    if (goingBack) { goingBack = false; navDepth = Math.max(0, navDepth - 1); } else navDepth++;
    route();
  });

  /* ---------- boot ---------- */
  updateThemeColor();
  loadInitial().then(function (bundle) {
    DB = index(bundle);
    route();
    var stale = !lastCheck || (Date.now() - new Date(lastCheck).getTime()) > 6 * 3600 * 1000;
    if (navigator.onLine !== false && stale) setTimeout(function () { checkUpdate(false); }, 1500);
    else if (navigator.onLine !== false) setTimeout(function () { checkUpdate(false); }, 4000);
  }).catch(function () {
    document.getElementById('view').innerHTML = '<div class="empty">데이터를 불러오지 못했어요.<br>인터넷에 연결한 뒤 다시 열어 주세요.</div>';
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
