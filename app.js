// ══════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════
const GAS_URL   = 'https://script.google.com/macros/s/AKfycbyItj-3QhjGvVu4H0wAPLdMWijAgTmUN75v1cFoGj7Wm6vFUJl6AuyCFIRM-QcIF2g/exec';
const GAS_READY = !!GAS_URL && !GAS_URL.includes('PASTE_YOUR');
const DEVTOOLS_BLOCK = false;
const MAINTENANCE_MODE = false;
const AUTO_ADVANCE_CORRECT_SECS = 1;
const AUTO_ADVANCE_WRONG_SECS   = 2;
const SESSION_STORAGE_KEY = 'quizzer_session_v1';

// ── State ──────────────────────────────────────────────────────────────────
let publicFolders  = [];
let privateFolders = [];
let allBanks = [];

let activeMainFolderId  = null;
let activeSubfolderId   = null;
let vaultMode           = 'public';
let searchQuery         = '';

let mobMainFolderId   = null;
let mobSubfolderId    = null;

let selectedIds = new Set();

let sessionQuestions=[], sessionResults=[], wrongPool=[];
let currentIdx=0, correctCount=0, wrongCount=0, autoTimer=null, totalUniqueQuestions=0;
let retryCounts={};
let currentRole=null;
let questionTimerInterval=null, sessionTimerInterval=null;
let questionTimeLeft=0, sessionTimeLeft=0;

let pendingDeleteId=null, pendingPublishId=null, pendingUnpublishId=null;
let ctxFileId=null, ctxFileName=null, pendingMemberRemoveId=null, pendingTransferId=null;

const $ = id => document.getElementById(id);

// ── DevTools block ─────────────────────────────────────────────────────────
document.addEventListener('contextmenu', e => { if (DEVTOOLS_BLOCK) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (!DEVTOOLS_BLOCK) return;
  const k = e.key;
  if (k === 'F12') { e.preventDefault(); return; }
  if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c','K','k'].includes(k)) { e.preventDefault(); return; }
  if (e.ctrlKey && ['u','U','p','P','s','S'].includes(k)) { e.preventDefault(); return; }
});
window.addEventListener('beforeprint', e => e.preventDefault());


// ══════════════════════════════════════════════════════════════
//  LOADING OVERLAY
// ══════════════════════════════════════════════════════════════
let _loaderDepth = 0;
let _loaderDoneTimer = null;

function showLoader(msg = 'Loading…') {
  _loaderDepth++;
  const overlay = $('loading-overlay');
  if (_loaderDoneTimer) { clearTimeout(_loaderDoneTimer); _loaderDoneTimer = null; }
  overlay.classList.remove('lo-done', 'lo-hiding');
  overlay.querySelectorAll('.lo-bar').forEach(b => b.classList.add('lo-bar-scan'));
  $('lo-status').textContent = msg;
  overlay.classList.add('active');
  return Symbol('loader');
}

function updateLoader(msg) {
  const el = $('lo-status');
  if (el) el.textContent = msg;
}

function hideLoader() {
  _loaderDepth = Math.max(0, _loaderDepth - 1);
  if (_loaderDepth > 0) return;
  const overlay = $('loading-overlay');
  overlay.querySelectorAll('.lo-bar').forEach(b => b.classList.remove('lo-bar-scan'));
  overlay.classList.add('lo-done');
  _loaderDoneTimer = setTimeout(() => {
    overlay.classList.add('lo-hiding');
    setTimeout(() => {
      overlay.classList.remove('active', 'lo-done', 'lo-hiding');
      overlay.querySelectorAll('.lo-bar').forEach(b => b.classList.remove('lo-bar-scan'));
    }, 420);
    _loaderDoneTimer = null;
  }, 700);
}

async function withLoader(msg, fn) {
  showLoader(msg);
  try { return await fn(); } finally { hideLoader(); }
}


// ══════════════════════════════════════════════════════════════
//  DOM READY
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (MAINTENANCE_MODE) { window.location.replace('maintenance.html'); return; }

  $('refresh-btn').addEventListener('click', () => loadAllFolders());
  $('btn-mode-public').addEventListener('click', () => setVaultMode('public'));
  $('btn-mode-private').addEventListener('click', () => setVaultMode('private'));

  $('breadcrumb-back').addEventListener('click', () => {
    activeMainFolderId = null;
    activeSubfolderId  = null;
    searchQuery = '';
    $('search-input').value = '';
    showDesktopLevel(1);
    renderFolderCards();
    updateHeaderState();
  });

  // Desktop search
  $('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    if (!activeMainFolderId) {
      handleGlobalSearch(searchQuery);
    } else {
      handleScopedSearch(searchQuery);
    }
  });

  // Select All (desktop bank pane header — delegated)
  document.addEventListener('click', e => {
    if (e.target.id === 'desktop-select-all-btn') toggleDesktopSelectAll();
  });

  // Mobile search overlay
  $('mob-search-close-btn').addEventListener('click', closeMobileSearchOverlay);
  $('mob-global-search-input').addEventListener('input', e => {
    handleMobileGlobalSearch(e.target.value.toLowerCase().trim());
  });
  $('mob-search-overlay').addEventListener('click', e => {
    if (e.target === $('mob-search-overlay')) closeMobileSearchOverlay();
  });

  $('start-btn').addEventListener('click', startQuiz);
  $('mobile-start-btn').addEventListener('click', () => { syncMobileToggles(); startQuiz(); });
  $('mobile-settings-btn').addEventListener('click', openSettingsModal);
  $('settings-done-btn').addEventListener('click', () => { syncMobileToggles(); $('settings-modal').classList.remove('open'); });
  $('settings-modal').addEventListener('click', e => { if (e.target === $('settings-modal')) { syncMobileToggles(); $('settings-modal').classList.remove('open'); } });

  $('mob-select-all-btn').addEventListener('click', toggleMobileSelectAll);

  $('quit-btn').addEventListener('click', openQuitModal);
  $('quit-keep').addEventListener('click', closeQuitModal);
  $('quit-confirm').addEventListener('click', confirmQuit);
  $('quit-modal').addEventListener('click', e => { if (e.target === $('quit-modal')) closeQuitModal(); });
  $('btn-landing').addEventListener('click', goLanding);
  $('btn-retake').addEventListener('click', retakeSession);
  $('password-submit').addEventListener('click', submitPassword);
  $('password-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitPassword(); });
  $('tray-collapsed').addEventListener('click', toggleTray);
  $('delete-keep-btn').addEventListener('click', () => $('delete-bank-modal').classList.remove('open'));
  $('delete-confirm-btn').addEventListener('click', doDeleteBank);
  $('delete-bank-modal').addEventListener('click', e => { if (e.target === $('delete-bank-modal')) $('delete-bank-modal').classList.remove('open'); });
  $('publish-cancel-btn').addEventListener('click', () => $('publish-modal').classList.remove('open'));
  $('publish-confirm-btn').addEventListener('click', doPublishBank);
  $('publish-modal').addEventListener('click', e => { if (e.target === $('publish-modal')) $('publish-modal').classList.remove('open'); });
  $('unpublish-cancel-btn').addEventListener('click', () => $('unpublish-modal').classList.remove('open'));
  $('unpublish-confirm-btn').addEventListener('click', doUnpublishBank);
  $('unpublish-modal').addEventListener('click', e => { if (e.target === $('unpublish-modal')) $('unpublish-modal').classList.remove('open'); });
  $('rename-file-cancel').addEventListener('click', () => $('rename-file-modal').classList.remove('open'));
  $('rename-file-confirm').addEventListener('click', doRenameFile);
  $('rename-file-input').addEventListener('keydown', e => { if (e.key === 'Enter') doRenameFile(); });
  $('rename-file-modal').addEventListener('click', e => { if (e.target === $('rename-file-modal')) $('rename-file-modal').classList.remove('open'); });
  $('transfer-file-cancel').addEventListener('click', () => $('transfer-file-modal').classList.remove('open'));
  $('transfer-file-confirm').addEventListener('click', doTransferFile);
  $('transfer-file-modal').addEventListener('click', e => { if (e.target === $('transfer-file-modal')) $('transfer-file-modal').classList.remove('open'); });
  $('member-remove-cancel').addEventListener('click', () => $('member-remove-modal').classList.remove('open'));
  $('member-remove-confirm').addEventListener('click', doMemberRemove);
  $('member-remove-modal').addEventListener('click', e => { if (e.target === $('member-remove-modal')) $('member-remove-modal').classList.remove('open'); });
  $('ctx-file-rename').addEventListener('click', () => { hideFileCtxMenu(); openRenameFileModal(); });
  $('ctx-file-transfer').addEventListener('click', () => { hideFileCtxMenu(); openTransferFileModal(); });
  $('ctx-file-remove').addEventListener('click', () => { hideFileCtxMenu(); openRemoveFileModal(); });

  $('resume-btn').addEventListener('click', resumeSavedSession);
  $('fresh-btn').addEventListener('click', () => { clearSavedSession(); $('resume-modal').classList.remove('open'); });
  $('resume-modal').addEventListener('click', e => { if (e.target === $('resume-modal')) { clearSavedSession(); $('resume-modal').classList.remove('open'); } });

  document.addEventListener('click', hideFileCtxMenu);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideFileCtxMenu();
      closeMobileSearchOverlay();
    }
  });

  setTimeout(() => {
    $('page-splash').classList.add('fade-out');
    setTimeout(() => {
      $('page-splash').classList.add('hidden');
      showPasswordGate();
    }, 600);
  }, 4200);
});


// ══════════════════════════════════════════════════════════════
//  INDEXEDDB HELPERS
// ══════════════════════════════════════════════════════════════
const IDB_NAME = 'quizzer_db', IDB_STORE = 'kv';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}
async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}


// ══════════════════════════════════════════════════════════════
//  SESSION PERSISTENCE
// ══════════════════════════════════════════════════════════════
function buildSessionPayload() {
  return {
    sessionQuestions,
    sourceQuestions: window._sessionSource || sessionQuestions.slice(0, totalUniqueQuestions),
    questionTimeLeft, sessionTimeLeft, currentIdx, correctCount, wrongCount,
    totalUniqueQuestions, retryCounts, sessionResults,
    settings: {
      mastery: $('toggle-mastery').checked, shuffle: $('toggle-shuffle').checked,
      auto: $('toggle-auto').checked, limit: $('select-limit').value,
      qtimer: $('select-qtimer').value, stimer: $('select-stimer').value,
    },
    selectedBankIds: Array.from(selectedIds),
    selectedBankNames: [...allBanks.filter(b => selectedIds.has(b.id)).map(b => b.name)],
    savedAt: Date.now(),
  };
}

function saveSession() {
  try {
    const payload = buildSessionPayload();
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload)); } catch (e) { console.warn('localStorage save failed:', e); }
    idbSet(SESSION_STORAGE_KEY, payload).catch(e => console.warn('IDB save failed:', e));
  } catch (e) { console.warn('Could not build session payload:', e); }
}

async function loadSavedSession() {
  try { const raw = localStorage.getItem(SESSION_STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) { try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) {} }
  try { const val = await idbGet(SESSION_STORAGE_KEY); return val || null; } catch (e) { return null; }
}

function clearSavedSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) {}
  idbDelete(SESSION_STORAGE_KEY).catch(() => {});
}

async function checkForSavedSession() {
  const saved = await loadSavedSession();
  if (!saved) return;
  const availableIds = new Set(allBanks.map(b => b.id));
  const allPresent = saved.selectedBankIds.every(id => availableIds.has(id));
  if (!allPresent) { clearSavedSession(); return; }
  const isMastery = !!(saved.settings && saved.settings.mastery);
  const total = saved.totalUniqueQuestions;
  const bankNames = saved.selectedBankNames || saved.selectedBankIds;
  let progressText;
  if (isMastery) {
    const mastered = saved.correctCount || 0;
    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
    progressText = mastered + ' / ' + total + ' mastered (' + pct + '%)';
  } else {
    const answered = saved.currentIdx;
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    progressText = answered + ' / ' + total + ' answered (' + pct + '%)';
  }
  $('resume-banks').textContent = bankNames.join(', ');
  $('resume-progress').textContent = progressText;
  $('resume-time').textContent = `Last active ${formatTimeAgo(saved.savedAt)}`;
  $('resume-modal').classList.add('open');
}

function formatTimeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function resumeSavedSession() {
  const saved = await loadSavedSession();
  if (!saved) { $('resume-modal').classList.remove('open'); return; }
  selectedIds = new Set(saved.selectedBankIds);
  sessionQuestions = saved.sessionQuestions;
  window._sessionSource = saved.sourceQuestions || saved.sessionQuestions.slice(0, saved.totalUniqueQuestions);
  currentIdx = saved.currentIdx; correctCount = saved.correctCount; wrongCount = saved.wrongCount;
  totalUniqueQuestions = saved.totalUniqueQuestions; retryCounts = saved.retryCounts || {}; sessionResults = saved.sessionResults || [];
  const s = saved.settings || {};
  if (s.mastery !== undefined)  $('toggle-mastery').checked = s.mastery;
  if (s.shuffle !== undefined)  $('toggle-shuffle').checked = s.shuffle;
  if (s.auto !== undefined)     $('toggle-auto').checked = s.auto;
  if (s.limit !== undefined)    $('select-limit').value = s.limit;
  if (s.qtimer !== undefined)   $('select-qtimer').value = s.qtimer;
  if (s.stimer !== undefined)   $('select-stimer').value = s.stimer;
  if (s.mastery !== undefined)  $('mob-toggle-mastery').checked = s.mastery;
  if (s.shuffle !== undefined)  $('mob-toggle-shuffle').checked = s.shuffle;
  if (s.auto !== undefined)     $('mob-toggle-auto').checked = s.auto;
  if (s.limit !== undefined)    $('mob-select-limit').value = s.limit;
  if (s.qtimer !== undefined)   $('mob-select-qtimer').value = s.qtimer;
  if (s.stimer !== undefined)   $('mob-select-stimer').value = s.stimer;
  $('resume-modal').classList.remove('open');
  stopQuestionTimer(); stopSessionTimer();
  showPage('page-exam');
  const savedSessionTime = saved.sessionTimeLeft || 0;
  if (savedSessionTime > 0) {
    sessionTimeLeft = savedSessionTime; updateSessionTimerDisplay();
    $('session-timer-wrap').classList.remove('hidden'); syncTimerBar();
    sessionTimerInterval = setInterval(() => {
      sessionTimeLeft--; updateSessionTimerDisplay(); saveSession();
      if (sessionTimeLeft <= 0) { stopSessionTimer(); clearSavedSession(); showSummary(); }
    }, 1000);
  } else { startSessionTimer(); }
  renderQuestion(); updateTray(); updateStartBtn();
}


// ══════════════════════════════════════════════════════════════
//  ROLE / AUTH
// ══════════════════════════════════════════════════════════════
function applyRole(role) {
  currentRole = role;
  const isAdmin = role === 'admin';
  const html = isAdmin ? '👑 Admin' : '👤 Member';
  const cls  = isAdmin ? 'admin' : 'member';
  [$('role-badge-sidebar'), $('role-badge-desktop')].forEach(el => { el.innerHTML = html; el.className = `role-badge ${cls}`; });
  $('vault-toggle-wrap').classList.toggle('visible', isAdmin);
}

function setVaultMode(mode) {
  vaultMode = mode;
  const isP = mode === 'private';
  $('btn-mode-public').classList.toggle('active', !isP);
  $('btn-mode-private').classList.toggle('active', isP);
  $('btn-mode-private').classList.toggle('private-active', isP);
  $('materials-panel').classList.toggle('private-mode', isP);
  selectedIds.clear();
  activeMainFolderId = null;
  activeSubfolderId  = null;
  searchQuery = '';
  $('search-input').value = '';
  allBanks = getCurrentFolders().flatMap(mf => mf.subfolders.flatMap(sf => sf.banks));
  $('bank-count-badge').textContent = allBanks.length;
  showDesktopLevel(1);
  renderFolderCards();
  updateHeaderState();
  updateStartBtn();
  updateTray();
  refreshPublishFolderSelect();
}

function getCurrentFolders() { return vaultMode === 'private' ? privateFolders : publicFolders; }

function showPasswordGate() {
  $('password-modal').classList.add('open');
  $('password-err').textContent = ''; $('password-input').value = '';
  setTimeout(() => $('password-input').focus(), 300);
}

async function submitPassword() {
  const val = $('password-input').value.trim(); if (!val) return;
  $('password-submit').textContent = 'Checking…'; $('password-submit').disabled = true;
  try {
    showLoader('Verifying…');
    const data = await gasGet({ action: 'verify', code: val });
    if (data.ok) {
      hideLoader();
      $('password-modal').classList.remove('open');
      applyRole(data.role || 'member');
      $('page-landing').classList.remove('hidden');
      if (GAS_READY) {
        $('config-banner').classList.add('hidden');
        await loadAllFolders();
        await checkForSavedSession();
      } else {
        $('config-banner').classList.remove('hidden');
      }
    } else {
      hideLoader();
      const inp = $('password-input');
      inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
      $('password-err').textContent = 'Incorrect password. Try again.'; inp.value = '';
      setTimeout(() => inp.classList.remove('shake'), 400);
    }
  } catch {
    hideLoader();
    $('password-err').textContent = 'Network error. Try again.';
  } finally {
    $('password-submit').textContent = 'Unlock →'; $('password-submit').disabled = false;
  }
}

async function loadAllFolders() {
  if (!GAS_READY) return;
  const btn = $('refresh-btn'); btn.classList.add('spinning');
  showLoader('Syncing banks…');
  try {
    const pubData = await gasGet({ action: 'list', drive: 'public', role: currentRole || 'member' });
    if (!pubData.error) {
      const questionCache = {};
      publicFolders.flatMap(mf => mf.subfolders.flatMap(sf => sf.banks)).forEach(b => { if (b.questions) questionCache[b.id] = b.questions; });
      publicFolders = (pubData.folders || []).map(mf => ({
        ...mf,
        subfolders: mf.subfolders.map(sf => ({
          ...sf,
          banks: sf.banks.map(b => ({ ...b, questions: questionCache[b.id] || null }))
        }))
      }));
    }
    if (currentRole === 'admin') {
      updateLoader('Syncing vault…');
      const privData = await gasGet({ action: 'list', drive: 'private', role: 'admin' });
      if (!privData.error) {
        const questionCache = {};
        privateFolders.flatMap(mf => mf.subfolders.flatMap(sf => sf.banks)).forEach(b => { if (b.questions) questionCache[b.id] = b.questions; });
        privateFolders = (privData.folders || []).map(mf => ({
          ...mf,
          subfolders: mf.subfolders.map(sf => ({
            ...sf,
            banks: sf.banks.map(b => ({ ...b, questions: questionCache[b.id] || null, _isPrivate: true }))
          }))
        }));
      }
    }

    allBanks = getCurrentFolders().flatMap(mf => mf.subfolders.flatMap(sf => sf.banks));
    $('bank-count-badge').textContent = allBanks.length;

    if (activeMainFolderId) {
      const mf = getCurrentFolders().find(f => f.id === activeMainFolderId);
      if (mf) {
        renderFolderCards();
        renderSubfolderList(mf);
        if (activeSubfolderId) {
          const sf = mf.subfolders.find(s => s.id === activeSubfolderId);
          if (sf) renderBankList(sf);
        }
      } else {
        activeMainFolderId = null; activeSubfolderId = null;
        showDesktopLevel(1); renderFolderCards();
      }
    } else {
      renderFolderCards();
    }

    renderMobileLevel1();
    updateHeaderState();
    refreshPublishFolderSelect();
  } catch { showErr('Network error. Check your GAS URL.'); }
  finally { btn.classList.remove('spinning'); hideLoader(); }
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP NAVIGATION
// ══════════════════════════════════════════════════════════════

function showDesktopLevel(level) {
  const grid  = $('folder-card-grid');
  const panel = $('subfolder-panel');
  if (level === 1) {
    grid.classList.remove('hidden');
    panel.classList.add('hidden');
  } else {
    grid.classList.add('hidden');
    panel.classList.remove('hidden');
  }
}

function updateHeaderState() {
  const crumb   = $('nav-breadcrumb');
  const titleEl = $('materials-title-text');
  const badge   = $('bank-count-badge');
  const search  = $('search-input');

  if (activeMainFolderId) {
    const mf = getCurrentFolders().find(f => f.id === activeMainFolderId);
    titleEl.classList.add('hidden');
    badge.classList.add('hidden');
    crumb.classList.remove('hidden');
    $('breadcrumb-back-label').textContent = 'Folders';
    $('breadcrumb-current').textContent = mf ? mf.name : '';
    search.placeholder = `Search in ${mf ? mf.name : ''}…`;
  } else {
    titleEl.classList.remove('hidden');
    badge.classList.remove('hidden');
    crumb.classList.add('hidden');
    search.placeholder = 'Search all banks…';
    searchQuery = '';
    $('search-input').value = '';
  }
}


// ══════════════════════════════════════════════════════════════
//  SEARCH — RANKING ENGINE (shared desktop + mobile)
// ══════════════════════════════════════════════════════════════

/**
 * Score a name against a query.
 * Returns: 1 (starts with) | 2 (word boundary) | 3 (contains) | null (no match)
 */
function getMatchTier(name, query) {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (!n.includes(q)) return null;
  if (n.startsWith(q)) return 1;
  // Word boundary: preceded by space, dash, or parenthesis
  if (/[\s\-\(]/.test(n[n.indexOf(q) - 1] || ' ')) return 2;
  return 3;
}

/**
 * Build global search results across all folders.
 * Returns array of { type:'subfolder'|'bank', item, mf, sf(bank only), tier }
 * Sorted by tier asc, then subfolder before bank within same tier.
 */
function buildGlobalResults(query) {
  if (!query) return [];
  const results = [];
  const folders = getCurrentFolders();

  folders.forEach(mf => {
    // Subfolders
    mf.subfolders.forEach(sf => {
      const tier = getMatchTier(sf.name, query);
      if (tier !== null) {
        results.push({ type: 'subfolder', item: sf, mf, tier });
      }
    });
    // Banks inside each subfolder
    mf.subfolders.forEach(sf => {
      sf.banks.forEach(b => {
        const tier = getMatchTier(b.name, query);
        if (tier !== null) {
          results.push({ type: 'bank', item: b, mf, sf, tier });
        }
      });
    });
  });

  // Sort: tier asc, then subfolder before bank within same tier
  results.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.type !== b.type) return a.type === 'subfolder' ? -1 : 1;
    return a.item.name.localeCompare(b.item.name);
  });

  return results;
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP SEARCH — GLOBAL (Level 1)
// ══════════════════════════════════════════════════════════════

function handleGlobalSearch(query) {
  // Global search only fires when at level 1 (no activeMainFolderId)
  const grid  = $('folder-card-grid');
  const panel = $('subfolder-panel');

  if (!query) {
    // Restore folder card grid
    panel.classList.add('hidden');
    grid.classList.remove('hidden');
    renderFolderCards();
    return;
  }

  // Show results in the subfolder panel area (hide grid, show panel)
  grid.classList.add('hidden');
  panel.classList.remove('hidden');

  const results = buildGlobalResults(query);

  // Clear subfolder list, use bank pane for all results
  const list = $('subfolder-list');
  list.innerHTML = '';
  list.style.display = 'none';

  const pane = $('bank-pane');
  pane.style.borderLeft = 'none';
  pane.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'bank-pane-header';
  header.innerHTML = `<div class="bank-pane-title">Results <span class="bank-pane-title-count">${results.length}</span></div>`;
  pane.appendChild(header);

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'bank-pane-empty';
    empty.innerHTML = '<div class="bank-pane-empty-icon">🔍</div>No matches found.';
    pane.appendChild(empty);
    return;
  }

  const resultList = document.createElement('div');
  resultList.className = 'bank-list';

  results.forEach(r => {
    const row = document.createElement('div');
    row.className = 'search-result-row';

    const path = r.type === 'subfolder'
      ? `${r.mf.name}`
      : `${r.mf.name} › ${r.sf.name}`;

    const icon = r.type === 'subfolder' ? '📁' : '📋';
    const name = escHtml(r.item.name);

    row.innerHTML = `
      <div class="sr-icon">${icon}</div>
      <div class="sr-body">
        <span class="sr-name">${name}</span>
        <span class="sr-path">${escHtml(path)}</span>
      </div>
      ${r.type === 'bank' && selectedIds.has(r.item.id) ? '<div class="sr-check">✓</div>' : ''}`;

    if (r.type === 'subfolder') {
      row.addEventListener('click', () => {
        // Navigate to this subfolder
        activeMainFolderId = r.mf.id;
        activeSubfolderId  = r.item.id;
        searchQuery = query; // carry query to scoped search
        showDesktopLevel(2);
        renderFolderCards();
        renderSubfolderList(r.mf);
        // Pre-fill scoped search with query
        $('search-input').value = query;
        updateHeaderState();
        updateSelectAllBtn();
      });
    } else {
      row.addEventListener('click', () => {
        // Navigate to this bank's subfolder, filter to just this bank
        activeMainFolderId = r.mf.id;
        activeSubfolderId  = r.sf.id;
        searchQuery = query;
        showDesktopLevel(2);
        renderFolderCards();
        renderSubfolderList(r.mf);
        // Pre-fill scoped search with bank name to filter
        $('search-input').value = r.item.name;
        updateHeaderState();
        // Override the bank pane with just this bank
        renderFilteredBankPane(r.sf, r.item.name.toLowerCase());
      });
    }

    resultList.appendChild(row);
  });

  pane.appendChild(resultList);
}

/** Restore subfolder list panel border when leaving global search */
function _restoreSubfolderPanel() {
  const list = $('subfolder-list');
  list.style.display = '';
  const pane = $('bank-pane');
  pane.style.borderLeft = '';
}

/** Render bank pane filtered by a query string */
function renderFilteredBankPane(sf, filterQuery) {
  _restoreSubfolderPanel();
  const filtered = filterQuery
    ? sf.banks.filter(b => b.name.toLowerCase().includes(filterQuery))
    : sf.banks;

  const pane = $('bank-pane');
  pane.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'bank-pane-header';
  header.innerHTML = `
    <div class="bank-pane-title">
      ${escHtml(sf.name)}
      <span class="bank-pane-title-count">${filtered.length}</span>
    </div>`;
  pane.appendChild(header);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'bank-pane-empty';
    empty.innerHTML = '<div class="bank-pane-empty-icon">🔍</div>No banks match.';
    pane.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'bank-list';
  filtered.forEach(b => appendBankItem(list, b));
  pane.appendChild(list);
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP SEARCH — SCOPED (Level 2, inside a main folder)
// ══════════════════════════════════════════════════════════════

function handleScopedSearch(query) {
  if (!activeMainFolderId) return;
  const mf = getCurrentFolders().find(f => f.id === activeMainFolderId);
  if (!mf) return;

  _restoreSubfolderPanel();

  if (!query) {
    renderSubfolderList(mf);
    if (activeSubfolderId) {
      const sf = mf.subfolders.find(s => s.id === activeSubfolderId);
      if (sf) renderBankList(sf);
    }
    updateSelectAllBtn();
    return;
  }

  // Filter subfolder list
  const subList = $('subfolder-list');
  subList.innerHTML = '';
  const matchedSubs = mf.subfolders.filter(sf => sf.name.toLowerCase().includes(query));
  if (matchedSubs.length) {
    matchedSubs.forEach(sf => {
      const row = document.createElement('div');
      row.className = 'subfolder-item' + (sf.id === activeSubfolderId ? ' active' : '');
      row.dataset.id = sf.id;
      const icon = sf.id.startsWith('_ungrouped') ? '📂' : '📁';
      row.innerHTML = `
        <span class="subfolder-item-icon">${icon}</span>
        <span class="subfolder-item-name">${escHtml(sf.name)}</span>
        <span class="subfolder-count-badge">${sf.banks.length}</span>`;
      row.addEventListener('click', () => selectSubfolder(mf, sf));
      subList.appendChild(row);
    });
  } else {
    subList.innerHTML = '<div style="padding:1rem;font-size:0.75rem;color:var(--text-dim);text-align:center;">No subfolders match.</div>';
  }

  // Filter banks in active subfolder
  if (activeSubfolderId) {
    const sf = mf.subfolders.find(s => s.id === activeSubfolderId);
    if (sf) renderFilteredBankPane(sf, query);
  }
}


// ══════════════════════════════════════════════════════════════
//  MOBILE SEARCH OVERLAY (Global)
// ══════════════════════════════════════════════════════════════

function openMobileSearchOverlay() {
  $('mob-search-overlay').classList.add('open');
  $('mob-global-search-input').value = '';
  $('mob-search-results').innerHTML = '';
  setTimeout(() => $('mob-global-search-input').focus(), 200);
}

function closeMobileSearchOverlay() {
  $('mob-search-overlay').classList.remove('open');
  $('mob-global-search-input').value = '';
  $('mob-search-results').innerHTML = '';
}

function handleMobileGlobalSearch(query) {
  const container = $('mob-search-results');
  container.innerHTML = '';

  if (!query) return;

  const results = buildGlobalResults(query);

  if (!results.length) {
    container.innerHTML = `
      <div class="mob-search-empty">
        <div class="mob-search-empty-icon">🔍</div>
        No matches found.
      </div>`;
    return;
  }

  results.forEach(r => {
    const row = document.createElement('div');
    row.className = 'mob-search-result-row';

    const path = r.type === 'subfolder'
      ? r.mf.name
      : `${r.mf.name} › ${r.sf.name}`;

    const icon = r.type === 'subfolder' ? '📁' : '📋';

    row.innerHTML = `
      <div class="mob-sr-icon">${icon}</div>
      <div class="mob-sr-body">
        <div class="mob-sr-name">${escHtml(r.item.name)}</div>
        <div class="mob-sr-path">${escHtml(path)}</div>
      </div>
      ${r.type === 'bank' && selectedIds.has(r.item.id) ? '<div class="mob-sr-check">✓</div>' : ''}`;

    if (r.type === 'subfolder') {
      row.addEventListener('click', () => {
        closeMobileSearchOverlay();
        // Navigate mobile to level 3 of this subfolder
        mobMainFolderId = r.mf.id;
        openMobileLevel3(r.mf, r.item);
      });
    } else {
      row.addEventListener('click', () => {
        const bankQuery = r.item.name;
        closeMobileSearchOverlay();
        // Navigate to level 3, then filter
        mobMainFolderId = r.mf.id;
        openMobileLevel3(r.mf, r.sf);
        // After level 3 renders, filter the bank list and pre-fill search
        // We use a small timeout to let the DOM settle
        setTimeout(() => {
          renderMobileFilteredBankList(r.sf, bankQuery.toLowerCase());
        }, 50);
      });
    }

    container.appendChild(row);
  });
}

function renderMobileFilteredBankList(sf, filterQuery) {
  const pane = $('bank-pane-mobile');
  pane.innerHTML = '';
  const filtered = filterQuery
    ? sf.banks.filter(b => b.name.toLowerCase().includes(filterQuery))
    : sf.banks;

  if (!filtered.length) {
    pane.innerHTML = '<div class="bank-pane-empty"><div class="bank-pane-empty-icon">🔍</div>No banks match.</div>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'bank-list';
  filtered.forEach(b => appendBankItem(list, b));
  pane.appendChild(list);
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 1: FOLDER CARD GRID
// ══════════════════════════════════════════════════════════════

function renderFolderCards() {
  const grid = $('folder-card-grid');
  grid.innerHTML = '';
  const folders = getCurrentFolders();
  const isPriv  = vaultMode === 'private';

  if (!folders.length) {
    grid.innerHTML = '<div class="bank-pane-empty" style="flex:1;"><div class="bank-pane-empty-icon">📭</div>No folders found.</div>';
    return;
  }

  folders.forEach((mf, i) => {
    const card = document.createElement('div');
    card.className = 'folder-card' + (isPriv ? ' private-card' : '') + (mf.id === activeMainFolderId ? ' active' : '');
    card.style.animationDelay = (i * 0.04) + 's';

    const icon = isPriv ? '🔒' : getFolderIcon(mf.name);
    const subCount  = mf.subfolderCount || 0;
    const bankCount = mf.bankCount || 0;

    card.innerHTML = `
      <div class="folder-card-name">${escHtml(mf.name)}</div>
      <div class="folder-card-counts">
        <span class="folder-card-count-pill">${subCount} subfolder${subCount !== 1 ? 's' : ''}</span>
        <span class="folder-card-count-pill">${bankCount} bank${bankCount !== 1 ? 's' : ''}</span>
      </div>`;

    card.addEventListener('click', () => openMainFolder(mf));
    grid.appendChild(card);
  });
}

function getFolderIcon(name) {
  const n = name.toUpperCase();
  if (n === 'FAR')  return '📊';
  if (n === 'AFAR') return '🌐';
  if (n === 'AUD')  return '🔍';
  if (n === 'MAS')  return '📈';
  if (n === 'TAX')  return '📋';
  if (n === 'RFBT') return '⚖️';
  return '📁';
}

function openMainFolder(mf) {
  activeMainFolderId = mf.id;
  activeSubfolderId  = null;
  searchQuery = '';
  $('search-input').value = '';
  _restoreSubfolderPanel();
  showDesktopLevel(2);
  renderFolderCards();
  renderSubfolderList(mf);
  updateHeaderState();
  updateSelectAllBtn();
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 2: SUBFOLDER LIST
// ══════════════════════════════════════════════════════════════

function renderSubfolderList(mf) {
  const list = $('subfolder-list');
  list.innerHTML = '';
  _restoreSubfolderPanel();

  const pane = $('bank-pane');
  pane.innerHTML = '<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📂</div>Select a subfolder to view its banks.</div>';

  if (!mf.subfolders.length) {
    list.innerHTML = '<div style="padding:1rem;font-size:0.78rem;color:var(--text-dim);text-align:center;">No subfolders found.</div>';
    return;
  }

  mf.subfolders.forEach(sf => {
    const row = document.createElement('div');
    row.className = 'subfolder-item' + (sf.id === activeSubfolderId ? ' active' : '');
    row.dataset.id = sf.id;
    const icon = sf.id.startsWith('_ungrouped') ? '📂' : '📁';
    row.innerHTML = `
      <span class="subfolder-item-icon">${icon}</span>
      <span class="subfolder-item-name">${escHtml(sf.name)}</span>
      <span class="subfolder-count-badge">${sf.banks.length}</span>`;
    row.addEventListener('click', () => selectSubfolder(mf, sf));
    list.appendChild(row);
  });

  if (mf.subfolders.length && !activeSubfolderId) {
    selectSubfolder(mf, mf.subfolders[0]);
  } else if (activeSubfolderId) {
    const sf = mf.subfolders.find(s => s.id === activeSubfolderId);
    if (sf) renderBankList(sf);
  }
}

function selectSubfolder(mf, sf) {
  activeSubfolderId = sf.id;
  $('subfolder-list').querySelectorAll('.subfolder-item').forEach(row => {
    row.classList.toggle('active', row.dataset.id === sf.id);
  });
  renderBankList(sf);
  updateSelectAllBtn();
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 3: BANK LIST
// ══════════════════════════════════════════════════════════════

function renderBankList(sf) {
  const pane = $('bank-pane');
  pane.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'bank-pane-header';
  const allSelected = sf.banks.length > 0 && sf.banks.every(b => selectedIds.has(b.id));
  header.innerHTML = `
    <div class="bank-pane-title">
      ${escHtml(sf.name)}
      <span class="bank-pane-title-count">${sf.banks.length}</span>
    </div>
    <button class="select-all-btn ${sf.banks.length === 0 ? 'hidden-btn' : ''}" id="desktop-select-all-btn">
      ${allSelected ? 'Deselect All' : 'Select All'}
    </button>`;
  pane.appendChild(header);

  if (!sf.banks.length) {
    const empty = document.createElement('div');
    empty.className = 'bank-pane-empty';
    empty.innerHTML = '<div class="bank-pane-empty-icon">📭</div>No banks in this subfolder.';
    pane.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'bank-list';
  sf.banks.forEach(b => appendBankItem(list, b));
  pane.appendChild(list);
}

function toggleDesktopSelectAll() {
  const mf = activeMainFolderId ? getCurrentFolders().find(f => f.id === activeMainFolderId) : null;
  const sf = (mf && activeSubfolderId) ? mf.subfolders.find(s => s.id === activeSubfolderId) : null;
  if (!sf || !sf.banks.length) return;
  const allSel = sf.banks.every(b => selectedIds.has(b.id));
  sf.banks.forEach(b => allSel ? selectedIds.delete(b.id) : selectedIds.add(b.id));
  renderBankList(sf);
  updateStartBtn(); updateTray(); updateSelectAllBtn();
}

function updateSelectAllBtn() {
  const btn = $('desktop-select-all-btn');
  if (!btn) return;
  const mf = activeMainFolderId ? getCurrentFolders().find(f => f.id === activeMainFolderId) : null;
  const sf = (mf && activeSubfolderId) ? mf.subfolders.find(s => s.id === activeSubfolderId) : null;
  if (!sf || !sf.banks.length) { btn.classList.add('hidden-btn'); return; }
  btn.classList.remove('hidden-btn');
  btn.textContent = sf.banks.every(b => selectedIds.has(b.id)) ? 'Deselect All' : 'Select All';
}


// ══════════════════════════════════════════════════════════════
//  MOBILE — 3-LEVEL DRILL-DOWN
// ══════════════════════════════════════════════════════════════

function renderMobileLevel1() {
  const container = $('mob-folder-list');
  container.innerHTML = '';
  const folders = getCurrentFolders();
  const isPriv  = vaultMode === 'private';

  let header = $('mob-level1').querySelector('.mobile-nav-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'mobile-nav-header';
    header.innerHTML = `
      <span class="mobile-nav-title">Question Banks</span>
      <span class="mobile-nav-count" id="mob-bank-count">${allBanks.length}</span>
      <button class="mob-search-icon-btn" id="mob-search-icon-btn" title="Search">🔍</button>`;
    $('mob-level1').insertBefore(header, container);
    // Re-bind since we just created the button
    header.querySelector('#mob-search-icon-btn').addEventListener('click', openMobileSearchOverlay);
  } else {
    const countEl = header.querySelector('#mob-bank-count');
    if (countEl) countEl.textContent = allBanks.length;
  }

  folders.forEach(mf => {
    const row = document.createElement('div');
    row.className = 'mobile-folder-row' + (isPriv ? ' private-row' : '');

    const icon     = isPriv ? '🔒' : getFolderIcon(mf.name);
    const subCount  = mf.subfolderCount || 0;
    const bankCount = mf.bankCount || 0;

    row.innerHTML = `
      <div class="mobile-folder-row-icon">${icon}</div>
      <div class="mobile-folder-row-info">
        <div class="mobile-folder-row-name">${escHtml(mf.name)}</div>
        <div class="mobile-folder-row-meta">${subCount} subfolder${subCount !== 1 ? 's' : ''} · ${bankCount} bank${bankCount !== 1 ? 's' : ''}</div>
      </div>
      <span class="mobile-folder-row-chevron">›</span>`;

    row.addEventListener('click', () => openMobileLevel2(mf));
    container.appendChild(row);
  });

  if (!folders.length) {
    container.innerHTML = '<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📭</div>No folders found.</div>';
  }
}

function openMobileLevel2(mf) {
  mobMainFolderId = mf.id;
  mobSubfolderId  = null;

  const level2 = $('mob-level2');
  const container = $('mob-subfolder-list');
  container.innerHTML = '';

  let header = level2.querySelector('.mobile-nav-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'mobile-nav-header';
    level2.insertBefore(header, level2.querySelector('.mobile-search-wrap'));
  }
  header.innerHTML = `
    <button class="mobile-back-btn" id="mob-back-to-l1">← Back</button>
    <span class="mobile-nav-title">${escHtml(mf.name)}</span>
    <span class="mobile-nav-count">${mf.subfolderCount || 0}</span>`;

  header.querySelector('#mob-back-to-l1').addEventListener('click', () => showMobileLevel(1));

  const searchEl = $('mob-search-input');
  searchEl.value = '';
  searchEl.oninput = () => {
    const q = searchEl.value.toLowerCase().trim();
    renderMobileSubfolders(mf, q);
  };

  renderMobileSubfolders(mf, '');
  showMobileLevel(2);
}

function renderMobileSubfolders(mf, query) {
  const container = $('mob-subfolder-list');
  container.innerHTML = '';

  const filtered = query
    ? mf.subfolders.filter(sf => sf.name.toLowerCase().includes(query))
    : mf.subfolders;

  if (!filtered.length) {
    container.innerHTML = '<div class="bank-pane-empty" style="padding:1.5rem;"><div class="bank-pane-empty-icon">📭</div>No subfolders found.</div>';
    return;
  }

  filtered.forEach(sf => {
    const row = document.createElement('div');
    row.className = 'mobile-subfolder-row';
    const icon = sf.id.startsWith('_ungrouped') ? '📂' : '📁';
    row.innerHTML = `
      <span class="mobile-subfolder-row-icon">${icon}</span>
      <span class="mobile-subfolder-row-name">${escHtml(sf.name)}</span>
      <span class="mobile-subfolder-row-count">${sf.banks.length}</span>
      <span class="mobile-subfolder-row-chevron">›</span>`;
    row.addEventListener('click', () => {
      const currentMf = getCurrentFolders().find(f => f.id === mobMainFolderId);
      if (currentMf) openMobileLevel3(currentMf, sf);
    });
    container.appendChild(row);
  });
}

function openMobileLevel3(mf, sf) {
  mobSubfolderId = sf.id;

  const level3 = $('mob-level3');

  let header = level3.querySelector('.mobile-nav-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'mobile-nav-header';
    level3.insertBefore(header, level3.querySelector('.mobile-bank-header'));
  }
  header.innerHTML = `
    <button class="mobile-back-btn" id="mob-back-to-l2">← Back</button>
    <span class="mobile-nav-title">${escHtml(sf.name)}</span>
    <span class="mobile-nav-count">${sf.banks.length}</span>`;

  header.querySelector('#mob-back-to-l2').addEventListener('click', () => {
    const currentMf = getCurrentFolders().find(f => f.id === mobMainFolderId);
    if (currentMf) openMobileLevel2(currentMf);
    else showMobileLevel(1);
  });

  $('mob-subfolder-title').textContent = sf.name;
  renderMobileBankList(sf);
  updateMobileSelectAllBtn(sf);
  showMobileLevel(3);
}

function renderMobileBankList(sf) {
  const pane = $('bank-pane-mobile');
  pane.innerHTML = '';
  if (!sf.banks.length) {
    pane.innerHTML = '<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📭</div>No banks in this subfolder.</div>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'bank-list';
  sf.banks.forEach(b => appendBankItem(list, b));
  pane.appendChild(list);
}

function toggleMobileSelectAll() {
  const mf = mobMainFolderId ? getCurrentFolders().find(f => f.id === mobMainFolderId) : null;
  const sf = (mf && mobSubfolderId) ? mf.subfolders.find(s => s.id === mobSubfolderId) : null;
  if (!sf || !sf.banks.length) return;
  const allSel = sf.banks.every(b => selectedIds.has(b.id));
  sf.banks.forEach(b => allSel ? selectedIds.delete(b.id) : selectedIds.add(b.id));
  renderMobileBankList(sf);
  updateMobileSelectAllBtn(sf);
  updateStartBtn(); updateTray();
}

function updateMobileSelectAllBtn(sf) {
  const btn = $('mob-select-all-btn');
  if (!sf || !sf.banks.length) { btn.classList.add('hidden-btn'); return; }
  btn.classList.remove('hidden-btn');
  btn.textContent = sf.banks.every(b => selectedIds.has(b.id)) ? 'Deselect All' : 'Select All';
}

function showMobileLevel(n) {
  $('mob-level1').classList.toggle('hidden', n !== 1);
  $('mob-level2').classList.toggle('hidden', n !== 2);
  $('mob-level3').classList.toggle('hidden', n !== 3);
}


// ══════════════════════════════════════════════════════════════
//  BANK ITEM  (shared desktop + mobile)
// ══════════════════════════════════════════════════════════════

function appendBankItem(container, bank) {
  const isSel   = selectedIds.has(bank.id);
  const isAdmin = currentRole === 'admin';
  const isPriv  = !!bank._isPrivate;
  const item = document.createElement('div');
  item.className = 'bank-item' + (isSel ? ' selected' : '') + (isPriv ? ' private-item' : '');
  item.dataset.id = bank.id;

  const qLabel    = bank.questions ? bank.questions.length + ' questions' : 'tap to load';
  const metaLabel = currentRole === 'admin' ? `${qLabel} · Added ${bank.addedAt}` : qLabel;

  let actions = '';
  if (isAdmin) {
    if (isPriv) {
      actions = `<div class="bank-actions">
        <button class="bank-action-btn publish" data-id="${bank.id}" data-name="${escHtml(bank.name)}" title="Publish to public">🌐</button>
        <button class="bank-action-btn delete" data-id="${bank.id}" title="Delete">🗑</button>
      </div>`;
    } else {
      actions = `<div class="bank-actions">
        <button class="bank-action-btn unpublish" data-id="${bank.id}" data-name="${escHtml(bank.name)}" title="Move back to Vault">📥</button>
        <button class="bank-action-btn delete" data-id="${bank.id}" title="Delete">🗑</button>
      </div>`;
    }
  }

  item.innerHTML = `
    <div class="bank-checkbox">${isSel ? '✓' : ''}</div>
    <div class="bank-icon">${isPriv ? '🔒' : '📋'}</div>
    <div class="bank-info">
      <div class="bank-name">${escHtml(bank.name)}</div>
      <div class="bank-meta">${metaLabel}</div>
    </div>
    ${actions}`;

  item.addEventListener('click', e => {
    if (e.target.closest('.bank-actions')) return;
    toggleBank(bank.id);
  });

  if (isAdmin) {
    const pb = item.querySelector('.bank-action-btn.publish');
    const ub = item.querySelector('.bank-action-btn.unpublish');
    const db = item.querySelector('.bank-action-btn.delete');
    if (pb) pb.addEventListener('click', e => { e.stopPropagation(); promptPublish(bank.id, bank.name); });
    if (ub) ub.addEventListener('click', e => { e.stopPropagation(); promptUnpublish(bank.id, bank.name); });
    if (db) db.addEventListener('click', e => { e.stopPropagation(); promptDeleteBank(bank.id, bank.name); });
  }

  if (!isPriv || (isPriv && isAdmin)) {
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFileCtxMenu(e.clientX, e.clientY, bank.id, bank.name, isPriv);
    });
    let pressTimer = null;
    item.addEventListener('touchstart', e => {
      pressTimer = setTimeout(() => {
        const touch = e.touches[0];
        showFileCtxMenu(touch.clientX, touch.clientY, bank.id, bank.name, isPriv);
      }, 600);
    }, { passive: true });
    item.addEventListener('touchend',  () => { clearTimeout(pressTimer); pressTimer = null; });
    item.addEventListener('touchmove', () => { clearTimeout(pressTimer); pressTimer = null; });
  }

  container.appendChild(item);
}

function toggleBank(id) {
  selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  _refreshCurrentBankPanes();
  updateStartBtn(); updateSelectAllBtn(); updateTray();
}

function _refreshCurrentBankPanes() {
  // Desktop
  if (activeMainFolderId && activeSubfolderId) {
    const mf = getCurrentFolders().find(f => f.id === activeMainFolderId);
    if (mf) {
      const sf = mf.subfolders.find(s => s.id === activeSubfolderId);
      if (sf) {
        // If scoped search is active, keep filtered view
        const q = $('search-input').value.toLowerCase().trim();
        if (q && activeMainFolderId) {
          renderFilteredBankPane(sf, q);
        } else {
          renderBankList(sf);
        }
      }
    }
  }
  // Mobile
  if (mobMainFolderId && mobSubfolderId && !$('mob-level3').classList.contains('hidden')) {
    const mf = getCurrentFolders().find(f => f.id === mobMainFolderId);
    if (mf) {
      const sf = mf.subfolders.find(s => s.id === mobSubfolderId);
      if (sf) {
        renderMobileBankList(sf);
        updateMobileSelectAllBtn(sf);
      }
    }
  }
}


// ══════════════════════════════════════════════════════════════
//  TRAY + START BUTTON
// ══════════════════════════════════════════════════════════════

function updateStartBtn() {
  const ok = selectedIds.size > 0 && allBanks.some(b => selectedIds.has(b.id));
  $('start-btn').disabled = !ok;
  $('mobile-start-btn').disabled = !ok;
}

function updateTray() {
  const tray = $('selected-tray');
  const sel  = allBanks.filter(b => selectedIds.has(b.id));
  if (!sel.length) { tray.classList.add('empty'); tray.classList.remove('expanded'); return; }
  tray.classList.remove('empty');
  const chips = $('tray-chips');
  chips.innerHTML = '';
  sel.slice(0, 3).forEach(b => { const c = document.createElement('span'); c.className = 'tray-chip'; c.textContent = b.name; c.title = b.name; chips.appendChild(c); });
  if (sel.length > 3) { const m = document.createElement('span'); m.className = 'tray-more'; m.textContent = `+${sel.length - 3} more`; chips.appendChild(m); }
  const inner = $('tray-drawer-inner');
  inner.innerHTML = '';
  sel.forEach(b => {
    const item = document.createElement('div');
    item.className = 'tray-drawer-item';
    item.innerHTML = `<span style="font-size:.8rem;flex-shrink:0;">${b._isPrivate ? '🔒' : '📋'}</span><span class="tray-drawer-item-name">${escHtml(b.name)}</span><button class="tray-drawer-remove" data-id="${b.id}">✕</button>`;
    item.querySelector('.tray-drawer-remove').addEventListener('click', e => {
      e.stopPropagation();
      selectedIds.delete(b.id);
      _refreshCurrentBankPanes();
      updateStartBtn(); updateSelectAllBtn(); updateTray();
    });
    inner.appendChild(item);
  });
}

function toggleTray() { $('selected-tray').classList.toggle('expanded'); }


// ══════════════════════════════════════════════════════════════
//  GAS HELPERS
// ══════════════════════════════════════════════════════════════
async function gasGet(params) {
  const url = new URL(GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return (await fetch(url.toString())).json();
}
async function gasPost(params, body) {
  const url = new URL(GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return (await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json();
}


// ══════════════════════════════════════════════════════════════
//  PUBLISH / UNPUBLISH
// ══════════════════════════════════════════════════════════════

function refreshPublishFolderSelect() {
  const sel = $('publish-folder-select');
  sel.innerHTML = '<option value="">📂 Ungrouped (root)</option>';
  publicFolders.forEach(mf => {
    mf.subfolders.filter(sf => !sf.id.startsWith('_ungrouped')).forEach(sf => {
      const o = document.createElement('option');
      o.value = sf.id;
      o.textContent = `📁 ${mf.name} › ${sf.name}`;
      sel.appendChild(o);
    });
  });
}

function promptPublish(id, name) {
  pendingPublishId = id;
  $('publish-modal-desc').textContent = `Where should "${name}" go in the public Drive?`;
  $('publish-modal').classList.add('open');
}

async function doPublishBank() {
  if (!pendingPublishId) return;
  const fid = $('publish-folder-select').value || '';
  $('publish-modal').classList.remove('open');
  try {
    const data = await withLoader('Publishing bank…', () => gasPost({ action: 'publish' }, { fileId: pendingPublishId, targetFolderId: fid, role: currentRole }));
    if (data.error) showErr('Publish failed: ' + data.error);
    else { showToast('🌐 Bank published!', 2800, 'success'); await loadAllFolders(); }
  } catch { showErr('Network error.'); }
  finally { pendingPublishId = null; }
}

function promptUnpublish(id, name) {
  pendingUnpublishId = id;
  $('unpublish-modal-desc').textContent = `"${name}" will move back to the Vault archive.`;
  $('unpublish-modal').classList.add('open');
}

async function doUnpublishBank() {
  if (!pendingUnpublishId) return;
  $('unpublish-modal').classList.remove('open');
  try {
    const data = await withLoader('Moving to vault…', () => gasPost({ action: 'unpublish' }, { fileId: pendingUnpublishId, role: currentRole }));
    if (data.error) showErr('Unpublish failed: ' + data.error);
    else { showToast('📥 Moved to Vault archive', 2800, 'success'); selectedIds.delete(pendingUnpublishId); await loadAllFolders(); updateTray(); updateStartBtn(); }
  } catch { showErr('Network error.'); }
  finally { pendingUnpublishId = null; }
}

function promptDeleteBank(id, name) {
  pendingDeleteId = id;
  $('delete-bank-desc').textContent = `"${name}" will be permanently removed.`;
  $('delete-bank-modal').classList.add('open');
}

async function doDeleteBank() {
  if (!pendingDeleteId) return;
  $('delete-bank-modal').classList.remove('open');
  try {
    const data = await withLoader('Deleting bank…', () => gasPost({ action: 'delete' }, { fileId: pendingDeleteId, role: currentRole }));
    if (data.error) showErr('Delete failed: ' + data.error);
    else { showToast('🗑 Bank deleted', 2800, 'success'); selectedIds.delete(pendingDeleteId); await loadAllFolders(); updateTray(); updateStartBtn(); }
  } catch { showErr('Network error.'); }
  finally { pendingDeleteId = null; }
}


// ══════════════════════════════════════════════════════════════
//  FILE CONTEXT MENU
// ══════════════════════════════════════════════════════════════

function showFileCtxMenu(x, y, fileId, fileName, isPrivate = false) {
  ctxFileId = fileId; ctxFileName = fileName;
  const menu   = $('file-ctx-menu');
  const isAdmin = currentRole === 'admin';
  const transferItem = $('ctx-file-transfer');
  if (transferItem) transferItem.style.display = (!isPrivate || isAdmin) ? '' : 'none';
  $('ctx-file-remove').textContent = isAdmin ? '🗑️ Delete File' : '🗂️ Remove File';
  const removeItem = $('ctx-file-remove');
  if (removeItem) removeItem.style.display = (!isPrivate || isAdmin) ? '' : 'none';
  menu.classList.remove('hidden');
  const mw = 170, mh = isPrivate ? 55 : 110;
  menu.style.left = (x + mw > window.innerWidth ? x - mw : x) + 'px';
  menu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}
function hideFileCtxMenu() { $('file-ctx-menu').classList.add('hidden'); }

function openRenameFileModal() {
  $('rename-file-input').value = ctxFileName; $('rename-file-err').textContent = '';
  $('rename-file-modal').classList.add('open');
  setTimeout(() => { const inp = $('rename-file-input'); inp.focus(); inp.select(); }, 300);
}

async function doRenameFile() {
  const name = $('rename-file-input').value.trim();
  if (!name) { $('rename-file-err').textContent = 'Please enter a name.'; return; }
  if (name === ctxFileName) { $('rename-file-modal').classList.remove('open'); return; }
  $('rename-file-modal').classList.remove('open');
  try {
    const data = await withLoader('Renaming file…', () => gasPost({ action: 'renameFile' }, { fileId: ctxFileId, fileName: name, role: currentRole, drive: vaultMode }));
    if (data.error) { showErr(data.error); return; }
    showToast(`✏️ Renamed to "${name}"`, 2800, 'success');
    await loadAllFolders();
  } catch { showErr('Network error. Try again.'); }
}

function openTransferFileModal() {
  pendingTransferId = ctxFileId;
  $('transfer-file-desc').textContent = `Where should "${ctxFileName}" go?`;
  const sel = $('transfer-folder-select');
  const isPrivateFile = vaultMode === 'private';
  const rootLabel = isPrivateFile ? '🔒 Vault root' : '📂 Ungrouped (root)';
  sel.innerHTML = `<option value="">${rootLabel}</option>`;
  const sourceFolders = isPrivateFile ? privateFolders : publicFolders;
  sourceFolders.forEach(mf => {
    mf.subfolders.filter(sf => !sf.id.startsWith('_ungrouped')).forEach(sf => {
      const o = document.createElement('option');
      o.value = sf.id;
      o.textContent = (isPrivateFile ? '🔒 ' : '📁 ') + mf.name + ' › ' + sf.name;
      sel.appendChild(o);
    });
  });
  $('transfer-file-modal').classList.add('open');
}

async function doTransferFile() {
  if (!pendingTransferId) return;
  const fid = $('transfer-folder-select').value || '';
  $('transfer-file-modal').classList.remove('open');
  try {
    const data = await withLoader('Transferring file…', () => gasPost({ action: 'transferFile' }, { fileId: pendingTransferId, targetFolderId: fid, role: currentRole, drive: vaultMode }));
    if (data.error) { showErr('Transfer failed: ' + data.error); return; }
    showToast('📂 File transferred!', 2800, 'success');
    await loadAllFolders();
  } catch { showErr('Network error.'); }
  finally { pendingTransferId = null; }
}

function openRemoveFileModal() {
  if (currentRole === 'admin') {
    pendingDeleteId = ctxFileId;
    $('delete-bank-desc').textContent = `"${ctxFileName}" will be permanently removed.`;
    $('delete-bank-modal').classList.add('open');
  } else {
    pendingMemberRemoveId = ctxFileId;
    $('member-remove-desc').textContent = `"${ctxFileName}" will be removed from public view. Admins can still recover it.`;
    $('member-remove-modal').classList.add('open');
  }
}

async function doMemberRemove() {
  if (!pendingMemberRemoveId) return;
  $('member-remove-modal').classList.remove('open');
  try {
    const data = await withLoader('Removing bank…', () => gasPost({ action: 'memberRemove' }, { fileId: pendingMemberRemoveId, role: currentRole }));
    if (data.error) { showErr('Remove failed: ' + data.error); return; }
    showToast('🗂️ Bank removed from public view', 2800, 'success');
    selectedIds.delete(pendingMemberRemoveId);
    await loadAllFolders(); updateTray(); updateStartBtn();
  } catch { showErr('Network error.'); }
  finally { pendingMemberRemoveId = null; }
}


// ══════════════════════════════════════════════════════════════
//  SETTINGS SYNC
// ══════════════════════════════════════════════════════════════
function syncMobileToggles() {
  $('toggle-mastery').checked = $('mob-toggle-mastery').checked;
  $('toggle-shuffle').checked = $('mob-toggle-shuffle').checked;
  $('toggle-auto').checked    = $('mob-toggle-auto').checked;
  $('select-limit').value     = $('mob-select-limit').value;
  $('select-qtimer').value    = $('mob-select-qtimer').value;
  $('select-stimer').value    = $('mob-select-stimer').value;
}

function openSettingsModal() {
  $('mob-toggle-mastery').checked = $('toggle-mastery').checked;
  $('mob-toggle-shuffle').checked = $('toggle-shuffle').checked;
  $('mob-toggle-auto').checked    = $('toggle-auto').checked;
  $('mob-select-limit').value     = $('select-limit').value;
  $('mob-select-qtimer').value    = $('select-qtimer').value;
  $('mob-select-stimer').value    = $('select-stimer').value;
  $('settings-modal').classList.add('open');
}


// ══════════════════════════════════════════════════════════════
//  QUIZ
// ══════════════════════════════════════════════════════════════

function parseWorkbook(ab) {
  const wb   = XLSX.read(ab, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (rows.length < 2) throw new Error('No data found.');
  const h    = rows[0].map(c => String(c).toLowerCase().trim());
  let qI = h.findIndex(c => c === 'question' || c.startsWith('q')), aI = h.findIndex(c => c === 'a'), bI = h.findIndex(c => c === 'b'), cI = h.findIndex(c => c === 'c'), dI = h.findIndex(c => c === 'd'), eI = h.findIndex(c => c === 'e'), ansI = h.findIndex(c => c === 'answer' || c === 'ans' || c === 'correct'), expI = h.findIndex(c => c === 'explanation' || c === 'exp' || c === 'reason');
  if (qI < 0) qI = 0; if (aI < 0) aI = 1; if (bI < 0) bI = 2; if (cI < 0) cI = 3; if (dI < 0) dI = 4; if (eI < 0) eI = 5; if (ansI < 0) ansI = 6; if (expI < 0) expI = 7;
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const r   = rows[i];
    const q   = String(r[qI] || '').trim(), ca = String(r[aI] || '').trim(), cb = String(r[bI] || '').trim(), cc = String(r[cI] || '').trim(), cd = String(r[dI] || '').trim(), ce = String(r[eI] || '').trim(), ans = String(r[ansI] || '').trim().toUpperCase().charAt(0), exp = String(r[expI] || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!q || !ca || !ans) continue;
    const choices = [{ letter: 'A', text: ca }];
    if (cb) choices.push({ letter: 'B', text: cb }); if (cc) choices.push({ letter: 'C', text: cc }); if (cd) choices.push({ letter: 'D', text: cd }); if (ce) choices.push({ letter: 'E', text: ce });
    parsed.push({ question: q, choices, answer: ans, type: choices.length === 2 ? 'True / False' : 'MCQ', explanation: exp });
  }
  if (!parsed.length) throw new Error('No valid questions found.');
  return parsed;
}

function shuffleChoices(q) {
  const ct = q.choices.find(c => c.letter === q.answer)?.text;
  const s  = [...q.choices].sort(() => Math.random() - 0.5).map((c, i) => ({ ...c, letter: String.fromCharCode(65 + i) }));
  return { ...q, choices: s, answer: s.find(c => c.text === ct)?.letter || q.answer };
}

async function startQuiz() {
  const sel = allBanks.filter(b => selectedIds.has(b.id));
  if (!sel.length) { showErr('Select at least one bank.'); return; }
  $('start-btn').disabled = true; $('mobile-start-btn').disabled = true;
  try {
    for (const bank of sel) {
      if (!bank.questions) {
        showLoader(`Loading "${bank.name}"…`);
        bank.questions = await fetchBankQuestions(bank);
        hideLoader();
        document.querySelectorAll(`.bank-item[data-id="${bank.id}"] .bank-meta`).forEach(mc => {
          mc.textContent = bank.questions.length + ' questions · Added ' + bank.addedAt;
        });
      }
    }
  } catch (err) {
    hideLoader(); showErr('Could not load bank: ' + err.message);
    $('start-btn').disabled = false; $('mobile-start-btn').disabled = false;
    return;
  }
  $('start-btn').disabled = false; $('mobile-start-btn').disabled = false;
  clearSavedSession();
  _beginSession(sel.flatMap(b => b.questions.map(q => ({ ...q, _bank: b.name }))));
}

async function fetchBankQuestions(bank) {
  const data = await gasGet({ action: 'get', fileId: bank.id });
  if (data.error) throw new Error(data.error);
  const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
  return parseWorkbook(bytes.buffer);
}

function _beginSession(source) {
  const sh  = $('toggle-shuffle').checked;
  let qs    = sh ? [...source].sort(() => Math.random() - 0.5) : [...source];
  const lim = parseInt($('select-limit').value) || 0;
  if (lim > 0) qs = qs.slice(0, lim);
  qs = qs.map(q => shuffleChoices(q));
  totalUniqueQuestions = qs.length;
  sessionQuestions = qs; window._sessionSource = qs.slice();
  currentIdx = 0; correctCount = 0; wrongCount = 0;
  sessionResults = []; wrongPool = []; retryCounts = {};
  stopQuestionTimer(); stopSessionTimer();
  showPage('page-exam'); startSessionTimer(); renderQuestion();
}

function renderQuestion() {
  const q       = sessionQuestions[currentIdx];
  const mastery = $('toggle-mastery').checked;
  const tot     = mastery ? totalUniqueQuestions : sessionQuestions.length;
  const cur     = mastery ? correctCount + 1 : currentIdx + 1;
  const pct     = mastery ? Math.round((correctCount / totalUniqueQuestions) * 100) : Math.round((currentIdx / sessionQuestions.length) * 100);
  $('prog-cur').textContent  = cur; $('prog-total').textContent = tot;
  $('prog-pct').textContent  = pct + '%'; $('prog-fill').style.width = pct + '%';
  $('hdr-c').textContent     = correctCount + ' ✓'; $('hdr-w').textContent = wrongCount + ' ✗';
  $('score-chips').style.display = mastery ? 'none' : 'flex';
  const card = $('question-card');
  card.innerHTML = ''; card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  const meta = document.createElement('div'); meta.className = 'question-meta';
  meta.innerHTML = `<span>Question ${cur} of ${tot}</span><span class="q-type-badge">${q.type}</span>${mastery ? '<span class="mastery-badge">⚡ Mastery</span>' : ''}${q._bank ? `<span class="q-bank-badge">📋 ${escHtml(q._bank)}</span>` : ''}`;
  card.appendChild(meta);
  const qt = document.createElement('div'); qt.className = 'question-text'; qt.textContent = q.question; card.appendChild(qt);
  const ce = document.createElement('div'); ce.className = 'choices';
  q.choices.forEach(c => { const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.innerHTML = `<div class="choice-letter">${c.letter}</div><div class="choice-text">${escHtml(c.text)}</div>`; btn.addEventListener('click', () => submitAnswer(c.letter, btn, q, card)); ce.appendChild(btn); });
  card.appendChild(ce);
  startQuestionTimer(q, card);
}

function clearAutoAdvance() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }

function submitAnswer(sel, btnEl, q, card) {
  clearAutoAdvance(); stopQuestionTimer();
  const ok     = sel === q.answer;
  const autoOn = $('toggle-auto').checked;
  const mastery = $('toggle-mastery').checked;
  card.querySelectorAll('.choice-btn').forEach(b => { b.disabled = true; if (b.querySelector('.choice-letter').textContent === q.answer) b.classList.add('correct'); });
  if (!ok) btnEl.classList.add('wrong');
  if (ok) correctCount++; else { wrongCount++; wrongPool.push(q); if (mastery) retryCounts[q.question] = (retryCounts[q.question] || 0) + 1; }
  sessionResults.push({ q, selected: sel, isCorrect: ok });
  $('hdr-c').textContent = correctCount + ' ✓'; $('hdr-w').textContent = wrongCount + ' ✗';
  const fb = document.createElement('div'); fb.className = 'answer-feedback ' + (ok ? 'correct' : 'wrong'); fb.textContent = ok ? '✓ Correct' : '✗ Incorrect'; card.appendChild(fb);
  if (q.explanation && !autoOn) { const rv = document.createElement('div'); rv.className = 'answer-reveal ' + (ok ? 'reveal-correct' : 'reveal-wrong'); rv.innerHTML = `<div class="reveal-body"><span style="font-size:.7rem;font-weight:600;font-family:'Sora',sans-serif;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;">Explanation</span><span class="exp-text"></span></div>`; rv.querySelector('.exp-text').textContent = q.explanation; card.appendChild(rv); }
  if (mastery && !ok) sessionQuestions.push(shuffleChoices(q));
  currentIdx++; saveSession(); currentIdx--;
  const last = currentIdx + 1 >= sessionQuestions.length;
  const advance = () => { currentIdx++; last ? (clearSavedSession(), showSummary()) : renderQuestion(); };
  if (autoOn) {
    const bw = document.createElement('div'); bw.className = 'auto-bar-wrap'; const bf = document.createElement('div'); bf.className = 'auto-bar-fill'; bw.appendChild(bf); card.appendChild(bw);
    const secs = ok ? AUTO_ADVANCE_CORRECT_SECS : AUTO_ADVANCE_WRONG_SECS;
    requestAnimationFrame(() => { bf.style.transition = `width ${secs}s linear`; bf.style.width = '0%'; });
    autoTimer = setTimeout(advance, secs * 1000);
  } else {
    const nb = document.createElement('button'); nb.className = 'next-btn show';
    nb.textContent = last ? 'See Results →' : 'Next Question →';
    nb.addEventListener('click', advance); card.appendChild(nb);
  }
}

function showSummary() {
  stopQuestionTimer(); stopSessionTimer();
  showPage('page-summary');
  const mastery = $('toggle-mastery').checked, total = totalUniqueQuestions, attempts = sessionResults.length;
  const firstAttemptMap = new Map();
  sessionResults.forEach(r => { if (!firstAttemptMap.has(r.q.question)) firstAttemptMap.set(r.q.question, r); });
  const firstAttempts = [...firstAttemptMap.values()];
  const ftCorrect = firstAttempts.filter(r => r.isCorrect).length;
  const ftWrong   = firstAttempts.filter(r => !r.isCorrect).length;
  const ftPct = total > 0 ? Math.round((ftCorrect / total) * 100) : 0;
  const retries = attempts - total;
  const pct = ftPct;
  const c = 2 * Math.PI * 45, ring = $('score-ring');
  ring.style.strokeDasharray = c; ring.style.strokeDashoffset = c;
  setTimeout(() => { ring.style.strokeDashoffset = c - (pct / 100) * c; ring.style.stroke = pct >= 80 ? '#4ade80' : pct >= 60 ? '#7c6af7' : '#f87171'; }, 100);
  $('sum-pct').textContent = pct + '%'; $('score-ring-label-text').textContent = mastery ? '1st Try' : 'Score';
  if (mastery) {
    $('sum-title').textContent = '🏆 All Mastered!'; $('sum-sub').textContent = `${total} questions mastered in ${attempts} attempts`;
    $('sum-correct').textContent = total; $('label-correct').textContent = 'Mastered';
    $('sum-wrong').textContent = retries; $('label-wrong').textContent = 'Retries';
    $('sum-total').textContent = ftPct + '%'; $('label-total').textContent = 'Accuracy';
  } else {
    $('sum-title').textContent = pct === 100 ? 'Perfect score!' : pct >= 80 ? 'Great work!' : pct >= 60 ? 'Good effort' : 'Keep practicing';
    $('sum-sub').textContent = `${ftCorrect} of ${total} correct`;
    $('sum-correct').textContent = ftCorrect; $('label-correct').textContent = 'Correct';
    $('sum-wrong').textContent = ftWrong; $('label-wrong').textContent = 'Incorrect';
    $('sum-total').textContent = total; $('label-total').textContent = 'Total';
  }
  buildWeakTopics();
  const weakToggle = $('weak-topics-toggle'), weakBody = $('weak-topics-body');
  weakToggle.onclick = () => { const open = weakToggle.classList.toggle('open'); weakBody.style.display = open ? 'block' : 'none'; weakToggle.querySelector('.weak-chevron').style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)'; };
  const list = $('review-list'); list.innerHTML = '';
  const seen = new Set(), uniq = [];
  sessionResults.forEach(r => { if (!seen.has(r.q.question)) { seen.add(r.q.question); uniq.push([...sessionResults].reverse().find(x => x.q.question === r.q.question)); } });
  uniq.forEach((r, i) => {
    const cc = r.q.choices.find(c => c.letter === r.q.answer), sc = r.q.choices.find(c => c.letter === r.selected);
    const ah = r.isCorrect
      ? `<div class="review-ans-block"><div class="review-ans-row"><span class="ca">✓ ${r.q.answer} — ${escHtml(cc?.text || '')}</span></div></div>`
      : `<div class="review-ans-block"><div class="review-ans-row">Your answer: <span class="wa">${r.selected} — ${escHtml(sc?.text || '')}</span></div><div class="review-ans-row">Correct: <span class="ca">${r.q.answer} — ${escHtml(cc?.text || '')}</span></div></div>`;
    const retries = retryCounts[r.q.question] || 0;
    const retryBadge = retries > 0 ? `<span class="retry-badge ${retries > 1 ? 'retry-high' : ''}">${retries} ${retries === 1 ? 'retry' : 'retries'}</span>` : '';
    const item = document.createElement('div'); item.className = 'review-item' + (retries > 1 ? ' retried' : '');
    item.innerHTML = `<div class="review-dot ${r.isCorrect ? 'c' : 'w'}"></div><div style="flex:1;min-width:0;"><div class="review-q" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;"><span style="flex:1;">${i + 1}. ${escHtml(r.q.question)}</span>${retryBadge}</div>${ah}</div>`;
    list.appendChild(item);
  });
}

async function retakeSession() {
  clearAutoAdvance(); clearSavedSession();
  const sel = allBanks.filter(b => selectedIds.has(b.id));
  const fromMemory = sel.flatMap(b => b.questions ? b.questions.map(q => ({ ...q, _bank: b.name })) : []);
  if (fromMemory.length) { _beginSession(fromMemory); return; }
  const source = window._sessionSource;
  if (source && source.length) { _beginSession(source); return; }
  showErr('Could not retake — please select banks and start a new session.');
}

function openQuitModal()  { $('quit-modal').classList.add('open'); }
function closeQuitModal() { $('quit-modal').classList.remove('open'); }
function confirmQuit()    { clearAutoAdvance(); stopQuestionTimer(); stopSessionTimer(); closeQuitModal(); goLanding(); }
function goLanding()      { showPage('page-landing'); }
function showPage(id)     { document.querySelectorAll('.page').forEach(p => p.classList.add('hidden')); $(id).classList.remove('hidden'); }


// ══════════════════════════════════════════════════════════════
//  TIMERS
// ══════════════════════════════════════════════════════════════
function syncTimerBar() {
  const qActive = !$('question-timer-wrap').classList.contains('hidden');
  const sActive = !$('session-timer-wrap').classList.contains('hidden');
  $('timer-bar').classList.toggle('hidden', !(qActive || sActive));
  const sep = $('timer-bar-sep'); if (sep) sep.classList.toggle('hidden', !(qActive && sActive));
}
function startQuestionTimer(q, card) {
  const secs = parseInt($('select-qtimer').value) || 0; if (!secs) return;
  questionTimeLeft = secs; updateQuestionTimerDisplay();
  $('question-timer-wrap').classList.remove('hidden'); syncTimerBar();
  questionTimerInterval = setInterval(() => {
    questionTimeLeft--; updateQuestionTimerDisplay();
    if (questionTimeLeft <= 0) {
      stopQuestionTimer();
      const btns = card.querySelectorAll('.choice-btn:not(:disabled)');
      if (btns.length) { const wrongBtn = Array.from(btns).find(b => b.querySelector('.choice-letter').textContent !== q.answer) || btns[0]; wrongBtn.click(); }
    }
  }, 1000);
}
function stopQuestionTimer() { clearInterval(questionTimerInterval); questionTimerInterval = null; const w = $('question-timer-wrap'); if (w) w.classList.add('hidden'); syncTimerBar(); }
function updateQuestionTimerDisplay() { const el = $('question-timer-val'); if (!el) return; el.textContent = questionTimeLeft + 's'; el.style.color = questionTimeLeft <= 5 ? 'var(--wrong)' : questionTimeLeft <= 10 ? 'var(--gold)' : 'var(--text)'; }
function startSessionTimer() {
  const mins = parseInt($('select-stimer').value) || 0; if (!mins) return;
  sessionTimeLeft = mins * 60; updateSessionTimerDisplay();
  $('session-timer-wrap').classList.remove('hidden'); syncTimerBar();
  sessionTimerInterval = setInterval(() => { sessionTimeLeft--; updateSessionTimerDisplay(); saveSession(); if (sessionTimeLeft <= 0) { stopSessionTimer(); clearSavedSession(); showSummary(); } }, 1000);
}
function stopSessionTimer()  { clearInterval(sessionTimerInterval); sessionTimerInterval = null; const w = $('session-timer-wrap'); if (w) w.classList.add('hidden'); syncTimerBar(); }
function updateSessionTimerDisplay() { const el = $('session-timer-val'); if (!el) return; const m = Math.floor(sessionTimeLeft / 60), s = sessionTimeLeft % 60; el.textContent = m + ':' + (s < 10 ? '0' : '') + s; el.style.color = sessionTimeLeft <= 30 ? 'var(--wrong)' : sessionTimeLeft <= 60 ? 'var(--gold)' : 'var(--text)'; }


// ══════════════════════════════════════════════════════════════
//  WEAK TOPICS
// ══════════════════════════════════════════════════════════════
function buildWeakTopics() {
  const bankMap = {};
  const firstAttemptMap = new Map();
  sessionResults.forEach(r => { if (!firstAttemptMap.has(r.q.question)) firstAttemptMap.set(r.q.question, r); });
  firstAttemptMap.forEach(r => { const bank = r.q._bank || 'Unknown'; if (!bankMap[bank]) bankMap[bank] = { correct: 0, total: 0 }; bankMap[bank].total++; if (r.isCorrect) bankMap[bank].correct++; });
  const banks = Object.entries(bankMap).map(([name, d]) => ({ name, pct: d.total ? Math.round((d.correct / d.total) * 100) : 0 }));
  banks.sort((a, b) => a.pct - b.pct);
  const container = $('weak-topics-body'); container.innerHTML = '';
  if (!banks.length) { const empty = document.createElement('div'); empty.style.cssText = 'font-size:0.8rem;color:var(--text-dim);padding:0.25rem 0;'; empty.textContent = 'No data available.'; container.appendChild(empty); return; }
  banks.forEach(b => {
    const color = b.pct >= 80 ? 'var(--correct)' : b.pct >= 60 ? 'var(--gold)' : 'var(--wrong)';
    const row = document.createElement('div'); row.className = 'weak-row';
    row.innerHTML = `<div class="weak-row-meta"><span class="weak-name">${escHtml(b.name)}</span><span class="weak-pct" style="color:${color}">${b.pct}%</span></div><div class="weak-bar-bg"><div class="weak-bar-fill" style="width:${b.pct}%;background:${color}"></div></div>`;
    container.appendChild(row);
  });
}


// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, dur = 2800, type = '') {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}
function showErr(msg) {
  const e = $('err-msg');
  e.textContent = msg; e.style.display = 'block';
  setTimeout(() => e.style.display = 'none', 4500);
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}