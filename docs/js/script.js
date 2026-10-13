/**
 * file-json-db docs – shared script
 * Theme toggle, sliding sidebar, copy buttons, search, active nav
 */
(function () {
  'use strict';

  // ─── Theme (before paint via inline in head is ideal; this is backup) ───
  (function initTheme() {
    try {
      const stored = localStorage.getItem('fjdb-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = stored || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('fjdb-theme', next); } catch (_) {}
    updateThemeIcon();
  };

  function updateThemeIcon() {
    const btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    // Moon for light (click to go dark), Sun for dark (click to go light)
    btn.innerHTML = isDark
      ? '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
      : '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  // ─── Sidebar toggle (desktop + mobile) ───
  window.toggleSidebar = function () {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (!sidebar) return;

    const isMobile = window.innerWidth <= 900;

    if (isMobile) {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('visible', sidebar.classList.contains('open'));
      document.body.classList.remove('sidebar-collapsed');
    } else {
      // Desktop: slide away / bring back
      sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');
      try {
        localStorage.setItem('fjdb-sidebar', sidebar.classList.contains('collapsed') ? 'collapsed' : 'open');
      } catch (_) {}
    }
  };

  function restoreSidebarState() {
    if (window.innerWidth <= 900) return;
    try {
      const state = localStorage.getItem('fjdb-sidebar');
      const sidebar = document.querySelector('.sidebar');
      if (state === 'collapsed' && sidebar) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
      }
    } catch (_) {}
  }

  function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  // ─── Copy buttons on code blocks ───
  function addCopyButtons() {
    document.querySelectorAll('pre').forEach(function (pre) {
      if (pre.parentElement && pre.parentElement.classList.contains('pre-wrap')) return;

      const wrap = document.createElement('div');
      wrap.className = 'pre-wrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      wrap.appendChild(btn);

      btn.addEventListener('click', function () {
        const code = pre.querySelector('code');
        const text = code ? code.innerText : pre.innerText;
        const done = function () {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text, done);
          });
        } else {
          fallbackCopy(text, done);
        }
      });
    });
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (_) {}
    document.body.removeChild(ta);
  }

  // ─── Active nav ───
  function highlightActiveNav() {
    const path = (window.location.pathname.split('/').pop() || 'index.html').split('?')[0];
    document.querySelectorAll('.nav-link').forEach(function (link) {
      const href = (link.getAttribute('href') || '').split('/').pop().split('?')[0];
      if (href === path || (path === '' && href === 'index.html')) {
        link.classList.add('active');
      } else {
        // keep existing active from HTML if it matches; otherwise leave as-is for multi-match
      }
    });
  }

  // ─── Search ───
  var PAGES = [
    { title: 'Introduction', url: 'index.html', keywords: 'overview home features introduction' },
    { title: 'Installation', url: 'installation.html', keywords: 'install npm yarn pnpm typescript' },
    { title: 'Quick Start', url: 'quick-start.html', keywords: 'quick start tutorial beginner' },
    { title: 'Architecture', url: 'architecture.html', keywords: 'architecture storage parts index atomic' },
    { title: 'Database', url: 'database.html', keywords: 'jsondb database collection list drop backup' },
    { title: 'Collections', url: 'collections.html', keywords: 'collection options autoId indexes maxPartSize' },
    { title: 'Documents & IDs', url: 'documents-ids.html', keywords: 'document id uuid objectid autoId' },
    { title: 'Storage & Part Files', url: 'storage.html', keywords: 'part files storage atomic write index.json' },
    { title: 'CRUD Operations', url: 'crud.html', keywords: 'insert find update delete crud' },
    { title: 'Queries & Operators', url: 'queries.html', keywords: 'query operators eq ne gt in regex and or' },
    { title: 'Query Builder', url: 'query-builder.html', keywords: 'limit skip sort project toArray count' },
    { title: 'Update Operators', url: 'updates.html', keywords: 'set inc push pull unset updateFunc' },
    { title: 'Indexes', url: 'indexes.html', keywords: 'index indexes rebuild performance' },
    { title: 'Transactions', url: 'transactions.html', keywords: 'transaction commit rollback snapshot' },
    { title: 'Aggregation', url: 'aggregation.html', keywords: 'aggregate match group sum avg count' },
    { title: 'Async API', url: 'async-api.html', keywords: 'async await promise insertAsync lock' },
    { title: 'Import & Export', url: 'import-export.html', keywords: 'import export json clear' },
    { title: 'Backups', url: 'backups.html', keywords: 'backup restore pack snapshot' },
    { title: 'Events', url: 'events.html', keywords: 'event emitter on insert update error' },
    { title: 'Error Handling', url: 'error-recovery.html', keywords: 'error recovery crash corrupted errorLevel' },
    { title: 'API Reference', url: 'api-reference.html', keywords: 'api methods reference types' },
    { title: 'Real-World Examples', url: 'real-world.html', keywords: 'example blog shop electron express cli' },
    { title: 'Performance', url: 'performance.html', keywords: 'performance limits concurrency memory' },
    { title: 'FAQ', url: 'faq.html', keywords: 'faq troubleshooting help questions' }
  ];

  function isInPagesDir() {
    return /\/pages\//.test(window.location.pathname) ||
      document.querySelector('script[src*="../js/script.js"]');
  }

  function initSearch() {
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    if (!input || !results) return;

    var inPages = isInPagesDir();

    input.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      if (q.length < 2) {
        results.innerHTML = '';
        results.style.display = 'none';
        return;
      }
      var matched = PAGES.filter(function (p) {
        return p.title.toLowerCase().indexOf(q) !== -1 ||
          p.keywords.toLowerCase().indexOf(q) !== -1;
      });
      if (matched.length === 0) {
        results.innerHTML = '<div class="search-item">No results</div>';
      } else {
        results.innerHTML = matched.map(function (p) {
          var href = p.url === 'index.html'
            ? (inPages ? '../index.html' : 'index.html')
            : (inPages ? p.url : 'pages/' + p.url);
          return '<a class="search-item" href="' + href + '">' + p.title + '</a>';
        }).join('');
      }
      results.style.display = 'block';
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search-box')) {
        results.style.display = 'none';
      }
    });
  }

  // ─── Ensure chrome exists (topbar / overlay / theme btn) if missing ───
  function ensureChrome() {
    // Overlay
    if (!document.querySelector('.sidebar-overlay')) {
      var ov = document.createElement('div');
      ov.className = 'sidebar-overlay';
      ov.addEventListener('click', closeMobileSidebar);
      document.body.appendChild(ov);
    } else {
      document.querySelector('.sidebar-overlay').addEventListener('click', closeMobileSidebar);
    }

    // Theme toggle
    if (!document.querySelector('.theme-toggle')) {
      var tb = document.createElement('button');
      tb.className = 'theme-toggle';
      tb.type = 'button';
      tb.setAttribute('onclick', 'toggleTheme()');
      tb.setAttribute('title', 'Toggle light/dark mode');
      document.body.appendChild(tb);
    }
    updateThemeIcon();
  }

  // ─── Init ───
  function init() {
    ensureChrome();
    restoreSidebarState();
    highlightActiveNav();
    addCopyButtons();
    initSearch();

    // Close mobile sidebar on nav click
    document.querySelectorAll('.nav-link').forEach(function (a) {
      a.addEventListener('click', function () {
        if (window.innerWidth <= 900) closeMobileSidebar();
      });
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 900) {
        closeMobileSidebar();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FileJsonDbDocs = {
    toggleTheme: window.toggleTheme,
    toggleSidebar: window.toggleSidebar,
    highlightActiveNav: highlightActiveNav
  };
})();
