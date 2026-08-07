// ══════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════
const GAS_URL   = 'https://script.google.com/macros/s/AKfycbyItj-3QhjGvVu4H0wAPLdMWijAgTmUN75v1cFoGj7Wm6vFUJl6AuyCFIRM-QcIF2g/exec';
const GAS_READY = !!GAS_URL && !GAS_URL.includes('PASTE_YOUR');
const DEVTOOLS_BLOCK          = true;
const MAINTENANCE_MODE        = false;
const AUTO_ADVANCE_CORRECT_SECS = 1;
const AUTO_ADVANCE_WRONG_SECS   = 2;
const SESSION_STORAGE_KEY     = 'quizzer_session_v1';
const SEARCH_DEBOUNCE_MS      = 200;
const BG_SCAN_DELAY_MS        = 250; // delay between background GAS calls

// ── State ──────────────────────────────────────────────────────
// Each main folder object:
// { id, name, subfolderCount?, bankCount?,
//   subfolders: null | [{ id, name, bankCount, banksLoaded, banks:null|[] }] }
let publicFolders  = [];
let privateFolders = [];

// Track loaded levels
const _subfoldersLoadedIds = new Set();  // main folder IDs whose subfolders are loaded
const _banksLoadedIds      = new Set();  // subfolder IDs whose banks are loaded

let allBanks           = [];
let activeMainFolderId = null;
let activeSubfolderId  = null;
let vaultMode          = 'public';
let searchQuery        = '';
let mobMainFolderId    = null;
let mobSubfolderId     = null;
let selectedIds        = new Set();
let selectedBankCache  = {}; // id → bank object for tray

let sessionQuestions=[], sessionResults=[], wrongPool=[];
let currentIdx=0, correctCount=0, wrongCount=0, autoTimer=null, totalUniqueQuestions=0;
let retryCounts={};
let currentRole=null;
let questionTimerInterval=null, sessionTimerInterval=null;
let questionTimeLeft=0, sessionTimeLeft=0;

let pendingDeleteId=null, pendingPublishId=null, pendingUnpublishId=null;
let ctxFileId=null, ctxFileName=null, pendingMemberRemoveId=null, pendingTransferId=null;

let _searchDebounceTimer = null;

const $ = id => document.getElementById(id);

// ── DevTools block ─────────────────────────────────────────────
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
let _loaderDepth = 0, _loaderDoneTimer = null;

function showLoader(msg = 'Loading…') {
  _loaderDepth++;
  const o = $('loading-overlay');
  if (_loaderDoneTimer) { clearTimeout(_loaderDoneTimer); _loaderDoneTimer = null; }
  o.classList.remove('lo-done', 'lo-hiding');
  o.querySelectorAll('.lo-bar').forEach(b => b.classList.add('lo-bar-scan'));
  $('lo-status').textContent = msg;
  o.classList.add('active');
}
function updateLoader(msg) { const el = $('lo-status'); if (el) el.textContent = msg; }
function hideLoader() {
  _loaderDepth = Math.max(0, _loaderDepth - 1);
  if (_loaderDepth > 0) return;
  const o = $('loading-overlay');
  o.querySelectorAll('.lo-bar').forEach(b => b.classList.remove('lo-bar-scan'));
  o.classList.add('lo-done');
  _loaderDoneTimer = setTimeout(() => {
    o.classList.add('lo-hiding');
    setTimeout(() => { o.classList.remove('active','lo-done','lo-hiding'); o.querySelectorAll('.lo-bar').forEach(b=>b.classList.remove('lo-bar-scan')); }, 420);
    _loaderDoneTimer = null;
  }, 700);
}
async function withLoader(msg, fn) { showLoader(msg); try { return await fn(); } finally { hideLoader(); } }


// ══════════════════════════════════════════════════════════════
//  DOM READY
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (MAINTENANCE_MODE) { window.location.replace('maintenance.html'); return; }

  $('refresh-btn').addEventListener('click', () => fullReset());
  $('btn-mode-public').addEventListener('click', () => setVaultMode('public'));
  $('btn-mode-private').addEventListener('click', () => setVaultMode('private'));

  $('breadcrumb-back').addEventListener('click', () => {
    activeMainFolderId = null; activeSubfolderId = null;
    searchQuery = ''; $('search-input').value = '';
    showDesktopLevel(1); renderFolderCards(); updateHeaderState();
  });

  $('search-input').addEventListener('input', e => {
    clearTimeout(_searchDebounceTimer);
    const val = e.target.value.toLowerCase().trim();
    _searchDebounceTimer = setTimeout(() => {
      searchQuery = val;
      if (!activeMainFolderId) handleGlobalSearch(searchQuery);
      else handleScopedSearch(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
  });

  document.addEventListener('click', e => { if (e.target.id === 'desktop-select-all-btn') toggleDesktopSelectAll(); });

  $('mob-search-close-btn').addEventListener('click', closeMobileSearchOverlay);
  $('mob-global-search-input').addEventListener('input', e => {
    clearTimeout(_searchDebounceTimer);
    const val = e.target.value.toLowerCase().trim();
    _searchDebounceTimer = setTimeout(() => handleMobileGlobalSearch(val), SEARCH_DEBOUNCE_MS);
  });
  $('mob-search-overlay').addEventListener('click', e => { if (e.target === $('mob-search-overlay')) closeMobileSearchOverlay(); });

  $('start-btn').addEventListener('click', startQuiz);
  $('mobile-start-btn').addEventListener('click', () => { syncMobileToggles(); startQuiz(); });
  $('mobile-settings-btn').addEventListener('click', openSettingsModal);
  $('settings-done-btn').addEventListener('click', () => { syncMobileToggles(); $('settings-modal').classList.remove('open'); });
  $('settings-modal').addEventListener('click', e => { if (e.target===$('settings-modal')) { syncMobileToggles(); $('settings-modal').classList.remove('open'); } });
  $('mob-select-all-btn').addEventListener('click', toggleMobileSelectAll);
  $('quit-btn').addEventListener('click', openQuitModal);
  $('quit-keep').addEventListener('click', closeQuitModal);
  $('quit-confirm').addEventListener('click', confirmQuit);
  $('quit-modal').addEventListener('click', e => { if (e.target===$('quit-modal')) closeQuitModal(); });
  $('btn-landing').addEventListener('click', goLanding);
  $('btn-retake').addEventListener('click', retakeSession);
  $('password-submit').addEventListener('click', submitPassword);
  $('password-input').addEventListener('keydown', e => { if (e.key==='Enter') submitPassword(); });
  $('tray-collapsed').addEventListener('click', toggleTray);
  $('delete-keep-btn').addEventListener('click', () => $('delete-bank-modal').classList.remove('open'));
  $('delete-confirm-btn').addEventListener('click', doDeleteBank);
  $('delete-bank-modal').addEventListener('click', e => { if (e.target===$('delete-bank-modal')) $('delete-bank-modal').classList.remove('open'); });
  $('publish-cancel-btn').addEventListener('click', () => $('publish-modal').classList.remove('open'));
  $('publish-confirm-btn').addEventListener('click', doPublishBank);
  $('publish-modal').addEventListener('click', e => { if (e.target===$('publish-modal')) $('publish-modal').classList.remove('open'); });
  $('unpublish-cancel-btn').addEventListener('click', () => $('unpublish-modal').classList.remove('open'));
  $('unpublish-confirm-btn').addEventListener('click', doUnpublishBank);
  $('unpublish-modal').addEventListener('click', e => { if (e.target===$('unpublish-modal')) $('unpublish-modal').classList.remove('open'); });
  $('rename-file-cancel').addEventListener('click', () => $('rename-file-modal').classList.remove('open'));
  $('rename-file-confirm').addEventListener('click', doRenameFile);
  $('rename-file-input').addEventListener('keydown', e => { if (e.key==='Enter') doRenameFile(); });
  $('rename-file-modal').addEventListener('click', e => { if (e.target===$('rename-file-modal')) $('rename-file-modal').classList.remove('open'); });
  $('transfer-file-cancel').addEventListener('click', () => $('transfer-file-modal').classList.remove('open'));
  $('transfer-file-confirm').addEventListener('click', doTransferFile);
  $('transfer-file-modal').addEventListener('click', e => { if (e.target===$('transfer-file-modal')) $('transfer-file-modal').classList.remove('open'); });
  $('member-remove-cancel').addEventListener('click', () => $('member-remove-modal').classList.remove('open'));
  $('member-remove-confirm').addEventListener('click', doMemberRemove);
  $('member-remove-modal').addEventListener('click', e => { if (e.target===$('member-remove-modal')) $('member-remove-modal').classList.remove('open'); });
  $('ctx-file-rename').addEventListener('click', () => { hideFileCtxMenu(); openRenameFileModal(); });
  $('ctx-file-transfer').addEventListener('click', () => { hideFileCtxMenu(); openTransferFileModal(); });
  $('ctx-file-remove').addEventListener('click', () => { hideFileCtxMenu(); openRemoveFileModal(); });
  $('resume-btn').addEventListener('click', resumeSavedSession);
  $('fresh-btn').addEventListener('click', () => { clearSavedSession(); $('resume-modal').classList.remove('open'); });
  $('resume-modal').addEventListener('click', e => { if (e.target===$('resume-modal')) { clearSavedSession(); $('resume-modal').classList.remove('open'); } });
  document.addEventListener('click', hideFileCtxMenu);
  document.addEventListener('keydown', e => { if (e.key==='Escape') { hideFileCtxMenu(); closeMobileSearchOverlay(); } });

  setTimeout(() => {
    $('page-splash').classList.add('fade-out');
    setTimeout(() => { $('page-splash').classList.add('hidden'); showPasswordGate(); }, 600);
  }, 4200);
});


// ══════════════════════════════════════════════════════════════
//  INDEXEDDB
// ══════════════════════════════════════════════════════════════
const IDB_NAME = 'quizzer_db', IDB_STORE = 'kv';
function idbOpen() {
  return new Promise((res,rej) => { const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=e=>e.target.result.createObjectStore(IDB_STORE); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function idbSet(key,val) { const db=await idbOpen(); return new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put(val,key); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e.target.error); }); }
async function idbGet(key) { const db=await idbOpen(); return new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,'readonly'); const r=tx.objectStore(IDB_STORE).get(key); r.onsuccess=e=>res(e.target.result??null); r.onerror=e=>rej(e.target.error); }); }
async function idbDelete(key) { const db=await idbOpen(); return new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e.target.error); }); }


// ══════════════════════════════════════════════════════════════
//  SESSION PERSISTENCE
// ══════════════════════════════════════════════════════════════
function buildSessionPayload() {
  return {
    sessionQuestions,
    sourceQuestions: window._sessionSource || sessionQuestions.slice(0, totalUniqueQuestions),
    questionTimeLeft, sessionTimeLeft, currentIdx, correctCount, wrongCount,
    totalUniqueQuestions, retryCounts, sessionResults,
    settings: { mastery:$('toggle-mastery').checked, shuffle:$('toggle-shuffle').checked, auto:$('toggle-auto').checked, limit:$('select-limit').value, qtimer:$('select-qtimer').value, stimer:$('select-stimer').value },
    selectedBankIds:   Array.from(selectedIds),
    selectedBankNames: Array.from(selectedIds).map(id => selectedBankCache[id]?.name || id),
    savedAt: Date.now(),
  };
}
function saveSession() { try { const p=buildSessionPayload(); try{localStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify(p));}catch(e){} idbSet(SESSION_STORAGE_KEY,p).catch(()=>{}); } catch(e){} }
async function loadSavedSession() { try{const r=localStorage.getItem(SESSION_STORAGE_KEY);if(r)return JSON.parse(r);}catch(e){try{localStorage.removeItem(SESSION_STORAGE_KEY);}catch(_){}} try{return await idbGet(SESSION_STORAGE_KEY);}catch(e){return null;} }
function clearSavedSession() { try{localStorage.removeItem(SESSION_STORAGE_KEY);}catch(_){} idbDelete(SESSION_STORAGE_KEY).catch(()=>{}); }

async function checkForSavedSession() {
  const saved = await loadSavedSession();
  if (!saved || !saved.selectedBankIds?.length) return;
  const isMastery = !!(saved.settings?.mastery);
  const total = saved.totalUniqueQuestions;
  const bankNames = saved.selectedBankNames || saved.selectedBankIds;
  let progressText;
  if (isMastery) { const m=saved.correctCount||0; progressText=m+' / '+total+' mastered ('+Math.round((m/total)*100)+'%)'; }
  else { const a=saved.currentIdx; progressText=a+' / '+total+' answered ('+Math.round((a/total)*100)+'%)'; }
  $('resume-banks').textContent=bankNames.join(', ');
  $('resume-progress').textContent=progressText;
  $('resume-time').textContent='Last active '+formatTimeAgo(saved.savedAt);
  $('resume-modal').classList.add('open');
}
function formatTimeAgo(ts) { const s=Math.floor((Date.now()-ts)/1000); if(s<60)return'just now'; const m=Math.floor(s/60); if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }

async function resumeSavedSession() {
  const saved = await loadSavedSession();
  if (!saved) { $('resume-modal').classList.remove('open'); return; }
  selectedIds = new Set(saved.selectedBankIds);
  saved.selectedBankIds.forEach((id,i) => { if (!selectedBankCache[id]) selectedBankCache[id]={id,name:saved.selectedBankNames?.[i]||id}; });
  sessionQuestions=saved.sessionQuestions; window._sessionSource=saved.sourceQuestions||saved.sessionQuestions.slice(0,saved.totalUniqueQuestions);
  currentIdx=saved.currentIdx; correctCount=saved.correctCount; wrongCount=saved.wrongCount;
  totalUniqueQuestions=saved.totalUniqueQuestions; retryCounts=saved.retryCounts||{}; sessionResults=saved.sessionResults||[];
  const s=saved.settings||{};
  ['mastery','shuffle','auto'].forEach(k=>{ if(s[k]!==undefined){$('toggle-'+k).checked=s[k];$('mob-toggle-'+k).checked=s[k];}});
  ['limit','qtimer','stimer'].forEach(k=>{ if(s[k]!==undefined){$('select-'+k).value=s[k];$('mob-select-'+k).value=s[k];}});
  $('resume-modal').classList.remove('open');
  stopQuestionTimer(); stopSessionTimer(); showPage('page-exam');
  const savedSessionTime = saved.sessionTimeLeft || 0;
  if (savedSessionTime > 0) {
    sessionTimeLeft=savedSessionTime; updateSessionTimerDisplay();
    $('session-timer-wrap').classList.remove('hidden'); syncTimerBar();
    sessionTimerInterval=setInterval(()=>{ sessionTimeLeft--; updateSessionTimerDisplay(); saveSession(); if(sessionTimeLeft<=0){stopSessionTimer();clearSavedSession();showSummary();}},1000);
  } else { startSessionTimer(); }
  renderQuestion(); updateTray(); updateStartBtn();
}


// ══════════════════════════════════════════════════════════════
//  ROLE / AUTH
// ══════════════════════════════════════════════════════════════
function applyRole(role) {
  currentRole = role;
  const isAdmin = role==='admin';
  const html = isAdmin?'👑 Admin':'👤 Member', cls = isAdmin?'admin':'member';
  [$('role-badge-sidebar'),$('role-badge-desktop')].forEach(el=>{el.innerHTML=html;el.className=`role-badge ${cls}`;});
  $('vault-toggle-wrap').classList.toggle('visible', isAdmin);
}

function setVaultMode(mode) {
  vaultMode=mode; const isP=mode==='private';
  $('btn-mode-public').classList.toggle('active',!isP);
  $('btn-mode-private').classList.toggle('active',isP);
  $('btn-mode-private').classList.toggle('private-active',isP);
  $('materials-panel').classList.toggle('private-mode',isP);
  selectedIds.clear(); selectedBankCache={};
  activeMainFolderId=null; activeSubfolderId=null;
  searchQuery=''; $('search-input').value='';
  _rebuildAllBanks();
  showDesktopLevel(1); renderFolderCards(); updateHeaderState();
  updateStartBtn(); updateTray(); refreshPublishFolderSelect();
}

function getCurrentFolders() { return vaultMode==='private' ? privateFolders : publicFolders; }

function showPasswordGate() {
  $('password-modal').classList.add('open');
  $('password-err').textContent=''; $('password-input').value='';
  setTimeout(()=>$('password-input').focus(),300);
}

async function submitPassword() {
  const val=$('password-input').value.trim(); if(!val) return;
  $('password-submit').textContent='Checking…'; $('password-submit').disabled=true;
  try {
    showLoader('Verifying…');
    const data = await gasGet({action:'verify',code:val});
    if (data.ok) {
      hideLoader();
      $('password-modal').classList.remove('open');
      applyRole(data.role||'member');
      $('page-landing').classList.remove('hidden');
      if (GAS_READY) {
        $('config-banner').classList.add('hidden');
        await loadLevel1(); // fast: just names
        checkForSavedSession();
        backgroundScanLevel2(); // silent: load all subfolders in background
      } else { $('config-banner').classList.remove('hidden'); }
    } else {
      hideLoader();
      const inp=$('password-input'); inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
      $('password-err').textContent='Incorrect password. Try again.'; inp.value='';
      setTimeout(()=>inp.classList.remove('shake'),400);
    }
  } catch { hideLoader(); $('password-err').textContent='Network error. Try again.'; }
  finally { $('password-submit').textContent='Unlock →'; $('password-submit').disabled=false; }
}


// ══════════════════════════════════════════════════════════════
//  4-LEVEL LAZY LOADING
// ══════════════════════════════════════════════════════════════

/** LEVEL 1 — Just folder names. Fast. Called on login. */
async function loadLevel1() {
  showLoader('Loading…');
  try {
    const pub = await gasGet({action:'listNames', drive:'public'});
    if (!pub.error) {
      (pub.folders||[]).forEach(fn => {
        if (!publicFolders.find(f=>f.id===fn.id))
          publicFolders.push({id:fn.id, name:fn.name, subfolders:null});
      });
    }
    if (currentRole==='admin') {
      const priv = await gasGet({action:'listNames', drive:'private'});
      if (!priv.error) {
        (priv.folders||[]).forEach(fn => {
          if (!privateFolders.find(f=>f.id===fn.id))
            privateFolders.push({id:fn.id, name:fn.name, subfolders:null});
        });
      }
    }
    renderFolderCards();
    renderMobileLevel1();
  } catch(e) { showErr('Network error loading folders.'); }
  finally { hideLoader(); }
}

/** LEVEL 2 — Subfolder names + counts for ONE main folder. */
async function loadLevel2(mainFolderId, drive, showSpinner=true) {
  if (_subfoldersLoadedIds.has(mainFolderId)) return;
  if (showSpinner) showLoader('Loading subfolders…');
  try {
    const data = await gasGet({action:'listSubfolders', folderId:mainFolderId, drive});
    if (data.error) { showErr(data.error); return; }
    const folders = drive==='private' ? privateFolders : publicFolders;
    const mf = folders.find(f=>f.id===mainFolderId);
    if (mf) {
      // Build subfolder objects — banks:null means not yet loaded
      mf.subfolders     = (data.subfolders||[]).map(sf=>({
        id:          sf.id,
        name:        sf.name,
        bankCount:   sf.bankCount,
        banks:       null, // not loaded yet
        _isLoose:    !!sf._isLoose
      }));
      mf.subfolderCount = data.subfolderCount || mf.subfolders.length;
      mf.bankCount      = data.bankCount || 0;
    }
    _subfoldersLoadedIds.add(mainFolderId);
    renderFolderCards(); // update count pills
    // If this is the active folder, re-render subfolder list
    if (mainFolderId===activeMainFolderId) renderSubfolderList(mf);
    renderMobileLevel1();
  } catch(e) { showErr('Network error loading subfolders.'); }
  finally { if (showSpinner) hideLoader(); }
}

/** LEVEL 3 — Bank metadata for ONE subfolder. */
async function loadLevel3(subfolderId, mainFolderId, drive, showSpinner=true) {
  if (_banksLoadedIds.has(subfolderId)) return;
  if (showSpinner) showLoader('Loading banks…');
  try {
    const data = await gasGet({action:'listSubfolder', subfolderId, mainFolderId, drive});
    if (data.error) { showErr(data.error); return; }
    const folders = drive==='private' ? privateFolders : publicFolders;
    // Find and update the subfolder
    for (const mf of folders) {
      if (!mf.subfolders) continue;
      const sf = mf.subfolders.find(s=>s.id===subfolderId);
      if (sf) {
        // Preserve cached questions
        const qCache = {};
        (sf.banks||[]).forEach(b=>{ if(b.questions) qCache[b.id]=b.questions; });
        sf.banks = (data.banks||[]).map(b=>({...b, questions:qCache[b.id]||null}));
        sf.bankCount = sf.banks.length;
        break;
      }
    }
    _banksLoadedIds.add(subfolderId);
    _rebuildAllBanks();
    // If this subfolder is currently active, re-render bank list
    if (subfolderId===activeSubfolderId) {
      const mf = getCurrentFolders().find(f=>f.id===activeMainFolderId);
      const sf = mf?.subfolders?.find(s=>s.id===subfolderId);
      if (sf) renderBankList(sf);
    }
    // Mobile level 3
    if (subfolderId===mobSubfolderId && !$('mob-level3').classList.contains('hidden')) {
      const mf = getCurrentFolders().find(f=>f.id===mobMainFolderId);
      const sf = mf?.subfolders?.find(s=>s.id===subfolderId);
      if (sf) renderMobileBankList(sf);
    }
  } catch(e) { showErr('Network error loading banks.'); }
  finally { if (showSpinner) hideLoader(); }
}

/** Background: load all Level 2 (subfolder names+counts) for all folders silently */
async function backgroundScanLevel2() {
  const drives = currentRole==='admin'
    ? [{folders:publicFolders,drive:'public'},{folders:privateFolders,drive:'private'}]
    : [{folders:publicFolders,drive:'public'}];
  for (const {folders,drive} of drives) {
    for (const mf of [...folders]) {
      if (!_subfoldersLoadedIds.has(mf.id)) {
        await loadLevel2(mf.id, drive, false);
        await _sleep(BG_SCAN_DELAY_MS);
      }
    }
  }
}

/** Background: load all Level 3 (bank metadata) for subfolders of a given main folder */
async function backgroundScanLevel3(mainFolderId, drive) {
  const folders = drive==='private' ? privateFolders : publicFolders;
  const mf = folders.find(f=>f.id===mainFolderId);
  if (!mf || !mf.subfolders) return;
  for (const sf of [...mf.subfolders]) {
    if (!_banksLoadedIds.has(sf.id)) {
      await loadLevel3(sf.id, mainFolderId, drive, false);
      await _sleep(BG_SCAN_DELAY_MS);
    }
  }
}

function _sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function _rebuildAllBanks() {
  allBanks = getCurrentFolders()
    .flatMap(mf=>(mf.subfolders||[]).flatMap(sf=>sf.banks||[]));
  $('bank-count-badge').textContent = allBanks.length;
}

/** Full reset — refresh button */
async function fullReset() {
  _subfoldersLoadedIds.clear();
  _banksLoadedIds.clear();
  publicFolders=[]; privateFolders=[];
  allBanks=[]; activeMainFolderId=null; activeSubfolderId=null;
  showDesktopLevel(1); $('search-input').value=''; searchQuery=''; updateHeaderState();
  const btn=$('refresh-btn'); btn.classList.add('spinning');
  await loadLevel1();
  btn.classList.remove('spinning');
  backgroundScanLevel2();
}

/** Ensure level 2 is loaded before showing a main folder */
async function ensureLevel2(mainFolderId) {
  if (!_subfoldersLoadedIds.has(mainFolderId)) {
    await loadLevel2(mainFolderId, vaultMode, true);
  }
}

/** Ensure level 3 is loaded before showing a subfolder */
async function ensureLevel3(subfolderId, mainFolderId) {
  if (!_banksLoadedIds.has(subfolderId)) {
    await loadLevel3(subfolderId, mainFolderId, vaultMode, true);
  }
}


// ══════════════════════════════════════════════════════════════
//  LOCAL STATE MUTATIONS (no GAS re-sync after actions)
// ══════════════════════════════════════════════════════════════
function _removeBankLocally(fileId) {
  getCurrentFolders().forEach(mf => {
    if (!mf.subfolders) return;
    mf.subfolders.forEach(sf => {
      if (!sf.banks) return;
      sf.banks = sf.banks.filter(b=>b.id!==fileId);
      sf.bankCount = sf.banks.length;
    });
    mf.bankCount = mf.subfolders.reduce((s,sf)=>s+(sf.bankCount||0),0);
  });
  selectedIds.delete(fileId); delete selectedBankCache[fileId];
  _banksLoadedIds.delete(fileId); // force re-load if needed
  _rebuildAllBanks();
}

function _renameBankLocally(fileId, newName) {
  getCurrentFolders().forEach(mf => {
    if (!mf.subfolders) return;
    mf.subfolders.forEach(sf => {
      if (!sf.banks) return;
      const b=sf.banks.find(b=>b.id===fileId);
      if (b) { b.name=newName; if(selectedBankCache[fileId]) selectedBankCache[fileId].name=newName; }
    });
  });
  _rebuildAllBanks();
}

function _moveBankLocally(fileId, targetSubfolderId) {
  let movedBank=null;
  getCurrentFolders().forEach(mf => {
    if (!mf.subfolders) return;
    mf.subfolders.forEach(sf => {
      if (!sf.banks) return;
      const idx=sf.banks.findIndex(b=>b.id===fileId);
      if (idx>=0) { movedBank=sf.banks.splice(idx,1)[0]; sf.bankCount=sf.banks.length; }
    });
    mf.bankCount=mf.subfolders.reduce((s,sf)=>s+(sf.bankCount||0),0);
  });
  if (movedBank && targetSubfolderId) {
    getCurrentFolders().forEach(mf => {
      if (!mf.subfolders) return;
      const sf=mf.subfolders.find(s=>s.id===targetSubfolderId);
      if (sf && sf.banks) { sf.banks.push(movedBank); sf.bankCount=sf.banks.length; mf.bankCount=mf.subfolders.reduce((s,sf)=>s+(sf.bankCount||0),0); }
    });
  }
  _rebuildAllBanks();
}

function _moveBankBetweenDrives(fileId) {
  _removeBankLocally(fileId);
  // Invalidate target drive so it re-fetches
  if (vaultMode==='private') publicFolders.forEach(mf=>{ _subfoldersLoadedIds.delete(mf.id); mf.subfolders?.forEach(sf=>_banksLoadedIds.delete(sf.id)); });
  else privateFolders.forEach(mf=>{ _subfoldersLoadedIds.delete(mf.id); mf.subfolders?.forEach(sf=>_banksLoadedIds.delete(sf.id)); });
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP NAVIGATION
// ══════════════════════════════════════════════════════════════
function showDesktopLevel(level) {
  $('folder-card-grid').classList.toggle('hidden', level!==1);
  $('subfolder-panel').classList.toggle('hidden', level!==2);
}

function updateHeaderState() {
  const crumb=$('nav-breadcrumb'), titleEl=$('materials-title-text'), badge=$('bank-count-badge'), search=$('search-input');
  if (activeMainFolderId) {
    const mf=getCurrentFolders().find(f=>f.id===activeMainFolderId);
    titleEl.classList.add('hidden'); badge.classList.add('hidden'); crumb.classList.remove('hidden');
    $('breadcrumb-back-label').textContent='Folders';
    $('breadcrumb-current').textContent=mf?mf.name:'';
    search.placeholder='Search in '+(mf?mf.name:'')+'…';
  } else {
    titleEl.classList.remove('hidden'); badge.classList.remove('hidden'); crumb.classList.add('hidden');
    search.placeholder='Search all banks…'; searchQuery=''; $('search-input').value='';
  }
}


// ══════════════════════════════════════════════════════════════
//  SEARCH — RANKING ENGINE
// ══════════════════════════════════════════════════════════════
function getMatchTier(name, query) {
  const n=name.toLowerCase(), q=query.toLowerCase();
  if (!n.includes(q)) return null;
  if (n.startsWith(q)) return 1;
  if (/[\s\-\(]/.test(n[n.indexOf(q)-1]||' ')) return 2;
  return 3;
}

function buildGlobalResults(query) {
  if (!query) return [];
  const results=[];
  getCurrentFolders().forEach(mf => {
    if (!mf.subfolders) return;
    mf.subfolders.forEach(sf => {
      const tier=getMatchTier(sf.name,query);
      if (tier!==null) results.push({type:'subfolder',item:sf,mf,tier});
      (sf.banks||[]).forEach(b => {
        const tier=getMatchTier(b.name,query);
        if (tier!==null) results.push({type:'bank',item:b,mf,sf,tier});
      });
    });
  });
  results.sort((a,b)=>a.tier!==b.tier?a.tier-b.tier:a.type==='subfolder'?-1:1);
  return results;
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP SEARCH
// ══════════════════════════════════════════════════════════════
function handleGlobalSearch(query) {
  const grid=$('folder-card-grid'), panel=$('subfolder-panel');
  if (!query) { panel.classList.add('hidden'); grid.classList.remove('hidden'); renderFolderCards(); return; }
  grid.classList.add('hidden'); panel.classList.remove('hidden');
  const results=buildGlobalResults(query);
  const list=$('subfolder-list'); list.innerHTML=''; list.style.display='none';
  const pane=$('bank-pane'); pane.style.borderLeft='none'; pane.innerHTML='';
  const hdr=document.createElement('div'); hdr.className='bank-pane-header';
  hdr.innerHTML=`<div class="bank-pane-title">Results <span class="bank-pane-title-count">${results.length}</span></div>`;
  pane.appendChild(hdr);
  if (!results.length) { const e=document.createElement('div'); e.className='bank-pane-empty'; e.innerHTML='<div class="bank-pane-empty-icon">🔍</div>No matches found.'; pane.appendChild(e); return; }
  const rl=document.createElement('div'); rl.className='bank-list';
  results.forEach(r => {
    const row=document.createElement('div'); row.className='search-result-row';
    const path=r.type==='subfolder'?r.mf.name:r.mf.name+' › '+r.sf.name;
    row.innerHTML=`<div class="sr-icon">${r.type==='subfolder'?'📁':'📋'}</div><div class="sr-body"><span class="sr-name">${escHtml(r.item.name)}</span><span class="sr-path">${escHtml(path)}</span></div>${r.type==='bank'&&selectedIds.has(r.item.id)?'<div class="sr-check">✓</div>':''}`;
    if (r.type==='subfolder') {
      row.addEventListener('click',async()=>{ activeMainFolderId=r.mf.id; activeSubfolderId=r.item.id; searchQuery=query; showDesktopLevel(2); renderFolderCards(); await ensureLevel2(r.mf.id); renderSubfolderList(getCurrentFolders().find(f=>f.id===r.mf.id)); $('search-input').value=query; updateHeaderState(); updateSelectAllBtn(); });
    } else {
      row.addEventListener('click',async()=>{ activeMainFolderId=r.mf.id; activeSubfolderId=r.sf.id; searchQuery=query; showDesktopLevel(2); renderFolderCards(); await ensureLevel2(r.mf.id); const mf=getCurrentFolders().find(f=>f.id===r.mf.id); renderSubfolderList(mf); $('search-input').value=r.item.name; updateHeaderState(); await ensureLevel3(r.sf.id,r.mf.id); renderFilteredBankPane(r.sf,r.item.name.toLowerCase()); });
    }
    rl.appendChild(row);
  });
  pane.appendChild(rl);
}

function _restoreSubfolderPanel() { $('subfolder-list').style.display=''; $('bank-pane').style.borderLeft=''; }

function renderFilteredBankPane(sf, filterQuery) {
  _restoreSubfolderPanel();
  const filtered=filterQuery?sf.banks?.filter(b=>b.name.toLowerCase().includes(filterQuery))||[]:(sf.banks||[]);
  const pane=$('bank-pane'); pane.innerHTML='';
  const hdr=document.createElement('div'); hdr.className='bank-pane-header';
  hdr.innerHTML=`<div class="bank-pane-title">${escHtml(sf.name)}<span class="bank-pane-title-count">${filtered.length}</span></div>`;
  pane.appendChild(hdr);
  if (!filtered.length) { const e=document.createElement('div'); e.className='bank-pane-empty'; e.innerHTML='<div class="bank-pane-empty-icon">🔍</div>No banks match.'; pane.appendChild(e); return; }
  const list=document.createElement('div'); list.className='bank-list';
  filtered.forEach(b=>appendBankItem(list,b)); pane.appendChild(list);
}

function handleScopedSearch(query) {
  if (!activeMainFolderId) return;
  const mf=getCurrentFolders().find(f=>f.id===activeMainFolderId);
  if (!mf||!mf.subfolders) return;
  _restoreSubfolderPanel();
  if (!query) { renderSubfolderList(mf); if(activeSubfolderId){const sf=mf.subfolders.find(s=>s.id===activeSubfolderId);if(sf)renderBankList(sf);} updateSelectAllBtn(); return; }
  const subList=$('subfolder-list'); subList.innerHTML='';
  mf.subfolders.filter(sf=>sf.name.toLowerCase().includes(query)).forEach(sf=>{
    const row=document.createElement('div'); row.className='subfolder-item'+(sf.id===activeSubfolderId?' active':''); row.dataset.id=sf.id;
    row.innerHTML=`<span class="subfolder-item-name">${escHtml(sf.name)}</span><span class="subfolder-count-badge">${sf.bankCount??'…'}</span>`;
    row.addEventListener('click',()=>selectSubfolder(mf,sf)); subList.appendChild(row);
  });
  if (!subList.children.length) subList.innerHTML='<div style="padding:1rem;font-size:0.75rem;color:var(--text-dim);text-align:center;">No subfolders match.</div>';
  if (activeSubfolderId) { const sf=mf.subfolders.find(s=>s.id===activeSubfolderId); if(sf&&sf.banks) renderFilteredBankPane(sf,query); }
}


// ══════════════════════════════════════════════════════════════
//  MOBILE SEARCH OVERLAY
// ══════════════════════════════════════════════════════════════
function openMobileSearchOverlay() { $('mob-search-overlay').classList.add('open'); $('mob-global-search-input').value=''; $('mob-search-results').innerHTML=''; setTimeout(()=>$('mob-global-search-input').focus(),200); }
function closeMobileSearchOverlay() { $('mob-search-overlay').classList.remove('open'); $('mob-global-search-input').value=''; $('mob-search-results').innerHTML=''; }

function handleMobileGlobalSearch(query) {
  const container=$('mob-search-results'); container.innerHTML='';
  if (!query) return;
  const results=buildGlobalResults(query);
  if (!results.length) { container.innerHTML='<div class="mob-search-empty"><div class="mob-search-empty-icon">🔍</div>No matches found.</div>'; return; }
  results.forEach(r=>{
    const row=document.createElement('div'); row.className='mob-search-result-row';
    const path=r.type==='subfolder'?r.mf.name:r.mf.name+' › '+r.sf.name;
    row.innerHTML=`<div class="mob-sr-icon">${r.type==='subfolder'?'📁':'📋'}</div><div class="mob-sr-body"><div class="mob-sr-name">${escHtml(r.item.name)}</div><div class="mob-sr-path">${escHtml(path)}</div></div>${r.type==='bank'&&selectedIds.has(r.item.id)?'<div class="mob-sr-check">✓</div>':''}`;
    if (r.type==='subfolder') { row.addEventListener('click',async()=>{ closeMobileSearchOverlay(); mobMainFolderId=r.mf.id; await ensureLevel2(r.mf.id); const mf=getCurrentFolders().find(f=>f.id===r.mf.id); if(mf) openMobileLevel3(mf,r.item); }); }
    else { row.addEventListener('click',async()=>{ const bq=r.item.name; closeMobileSearchOverlay(); mobMainFolderId=r.mf.id; await ensureLevel2(r.mf.id); const mf=getCurrentFolders().find(f=>f.id===r.mf.id); if(mf){await ensureLevel3(r.sf.id,r.mf.id); openMobileLevel3(mf,r.sf); setTimeout(()=>renderMobileFilteredBankList(r.sf,bq.toLowerCase()),50);} }); }
    container.appendChild(row);
  });
}

function renderMobileFilteredBankList(sf, filterQuery) {
  const pane=$('bank-pane-mobile'); pane.innerHTML='';
  const filtered=filterQuery?sf.banks?.filter(b=>b.name.toLowerCase().includes(filterQuery))||[]:(sf.banks||[]);
  if (!filtered.length){pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">🔍</div>No banks match.</div>';return;}
  const list=document.createElement('div'); list.className='bank-list';
  filtered.forEach(b=>appendBankItem(list,b)); pane.appendChild(list);
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 1: FOLDER CARD GRID
// ══════════════════════════════════════════════════════════════
function renderFolderCards() {
  const grid=$('folder-card-grid'); grid.innerHTML='';
  const folders=getCurrentFolders(), isPriv=vaultMode==='private';
  if (!folders.length) { grid.innerHTML='<div class="bank-pane-empty" style="flex:1;"><div class="bank-pane-empty-icon">📭</div>No folders found.</div>'; return; }
  folders.forEach((mf,i)=>{
    const card=document.createElement('div');
    card.className='folder-card'+(isPriv?' private-card':'')+(mf.id===activeMainFolderId?' active':'');
    card.style.animationDelay=(i*0.04)+'s';
    const subCount = mf.subfolderCount ?? (mf.subfolders ? mf.subfolders.length : '…');
    const bankCount = mf.bankCount ?? '…';
    card.innerHTML=`<div class="folder-card-name">${escHtml(mf.name)}</div><div class="folder-card-counts"><span class="folder-card-count-pill">${subCount} subfolder${subCount!==1?'s':''}</span><span class="folder-card-count-pill">${bankCount} bank${bankCount!==1?'s':''}</span></div>`;
    card.addEventListener('click',()=>openMainFolder(mf));
    grid.appendChild(card);
  });
}

async function openMainFolder(mf) {
  activeMainFolderId=mf.id; activeSubfolderId=null;
  searchQuery=''; $('search-input').value='';
  _restoreSubfolderPanel(); updateHeaderState();
  await ensureLevel2(mf.id);
  const loaded=getCurrentFolders().find(f=>f.id===mf.id);
  showDesktopLevel(2); renderFolderCards();
  if (loaded&&loaded.subfolders) {
    renderSubfolderList(loaded);
    // Kick off background scan of all subfolders' banks
    backgroundScanLevel3(mf.id, vaultMode);
  }
  updateSelectAllBtn();
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 2: SUBFOLDER LIST
// ══════════════════════════════════════════════════════════════
function renderSubfolderList(mf) {
  const list=$('subfolder-list'); list.innerHTML=''; _restoreSubfolderPanel();
  const pane=$('bank-pane'); pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📂</div>Select a subfolder to view its banks.</div>';
  if (!mf.subfolders||!mf.subfolders.length) { list.innerHTML='<div style="padding:1rem;font-size:0.78rem;color:var(--text-dim);text-align:center;">No subfolders found.</div>'; return; }
  mf.subfolders.forEach(sf=>{
    const row=document.createElement('div'); row.className='subfolder-item'+(sf.id===activeSubfolderId?' active':''); row.dataset.id=sf.id;
    row.innerHTML=`<span class="subfolder-item-name">${escHtml(sf.name)}</span><span class="subfolder-count-badge">${sf.bankCount??'…'}</span>`;
    row.addEventListener('click',()=>selectSubfolder(mf,sf)); list.appendChild(row);
  });
  if (!activeSubfolderId) selectSubfolder(mf,mf.subfolders[0]);
  else { const sf=mf.subfolders.find(s=>s.id===activeSubfolderId); if(sf) _openSubfolder(mf,sf); }
}

async function selectSubfolder(mf, sf) {
  activeSubfolderId=sf.id;
  $('subfolder-list').querySelectorAll('.subfolder-item').forEach(r=>r.classList.toggle('active',r.dataset.id===sf.id));
  await _openSubfolder(mf, sf);
  updateSelectAllBtn();
}

async function _openSubfolder(mf, sf) {
  if (!sf.banks) {
    // Show placeholder while loading
    const pane=$('bank-pane'); pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">⏳</div>Loading banks…</div>';
    await ensureLevel3(sf.id, mf.id);
    // Re-fetch sf reference after load
    const updatedMf=getCurrentFolders().find(f=>f.id===mf.id);
    const updatedSf=updatedMf?.subfolders?.find(s=>s.id===sf.id);
    if (updatedSf) renderBankList(updatedSf);
  } else {
    renderBankList(sf);
  }
}


// ══════════════════════════════════════════════════════════════
//  DESKTOP — LEVEL 3: BANK LIST
// ══════════════════════════════════════════════════════════════
function renderBankList(sf) {
  const pane=$('bank-pane'); pane.innerHTML='';
  const banks=sf.banks||[];
  const allSel=banks.length>0&&banks.every(b=>selectedIds.has(b.id));
  const hdr=document.createElement('div'); hdr.className='bank-pane-header';
  hdr.innerHTML=`<div class="bank-pane-title">${escHtml(sf.name)}<span class="bank-pane-title-count">${banks.length}</span></div><button class="select-all-btn ${banks.length===0?'hidden-btn':''}" id="desktop-select-all-btn">${allSel?'Deselect All':'Select All'}</button>`;
  pane.appendChild(hdr);
  if (!banks.length) { const e=document.createElement('div'); e.className='bank-pane-empty'; e.innerHTML='<div class="bank-pane-empty-icon">📭</div>No banks in this subfolder.'; pane.appendChild(e); return; }
  const list=document.createElement('div'); list.className='bank-list';
  banks.forEach(b=>appendBankItem(list,b)); pane.appendChild(list);
}

function toggleDesktopSelectAll() {
  const mf=activeMainFolderId?getCurrentFolders().find(f=>f.id===activeMainFolderId):null;
  const sf=mf&&activeSubfolderId?mf.subfolders?.find(s=>s.id===activeSubfolderId):null;
  if (!sf||!sf.banks?.length) return;
  const allSel=sf.banks.every(b=>selectedIds.has(b.id));
  sf.banks.forEach(b=>{ allSel?selectedIds.delete(b.id):selectedIds.add(b.id); if(!allSel)selectedBankCache[b.id]=b; else delete selectedBankCache[b.id]; });
  renderBankList(sf); updateStartBtn(); updateTray(); updateSelectAllBtn();
}

function updateSelectAllBtn() {
  const btn=$('desktop-select-all-btn'); if(!btn) return;
  const mf=activeMainFolderId?getCurrentFolders().find(f=>f.id===activeMainFolderId):null;
  const sf=mf&&activeSubfolderId?mf.subfolders?.find(s=>s.id===activeSubfolderId):null;
  if(!sf||!sf.banks?.length){btn.classList.add('hidden-btn');return;}
  btn.classList.remove('hidden-btn');
  btn.textContent=sf.banks.every(b=>selectedIds.has(b.id))?'Deselect All':'Select All';
}


// ══════════════════════════════════════════════════════════════
//  MOBILE — 3-LEVEL DRILL-DOWN
// ══════════════════════════════════════════════════════════════
function renderMobileLevel1() {
  const container=$('mob-folder-list'); container.innerHTML='';
  const folders=getCurrentFolders(), isPriv=vaultMode==='private';
  let header=$('mob-level1').querySelector('.mobile-nav-header');
  if (!header) {
    header=document.createElement('div'); header.className='mobile-nav-header';
    header.innerHTML=`<span class="mobile-nav-title">Question Banks</span><span class="mobile-nav-count" id="mob-bank-count">${allBanks.length}</span><button class="mob-search-icon-btn" id="mob-search-icon-btn" title="Search">🔍</button>`;
    $('mob-level1').insertBefore(header,container);
    header.querySelector('#mob-search-icon-btn').addEventListener('click',openMobileSearchOverlay);
  } else { const c=header.querySelector('#mob-bank-count'); if(c) c.textContent=allBanks.length; }
  folders.forEach(mf=>{
    const row=document.createElement('div'); row.className='mobile-folder-row'+(isPriv?' private-row':'');
    const subCount=mf.subfolderCount??(mf.subfolders?mf.subfolders.length:'…');
    const bankCount=mf.bankCount??'…';
    row.innerHTML=`<div class="mobile-folder-row-info"><div class="mobile-folder-row-name">${escHtml(mf.name)}</div><div class="mobile-folder-row-meta">${subCount} subfolder${subCount!==1?'s':''} · ${bankCount} bank${bankCount!==1?'s':''}</div></div><span class="mobile-folder-row-chevron">›</span>`;
    row.addEventListener('click',()=>openMobileLevel2(mf)); container.appendChild(row);
  });
  if (!folders.length) container.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📭</div>No folders found.</div>';
}

async function openMobileLevel2(mf) {
  mobMainFolderId=mf.id; mobSubfolderId=null;
  await ensureLevel2(mf.id);
  const loaded=getCurrentFolders().find(f=>f.id===mf.id)||mf;
  const level2=$('mob-level2'), container=$('mob-subfolder-list'); container.innerHTML='';
  let header=level2.querySelector('.mobile-nav-header');
  if (!header){header=document.createElement('div');header.className='mobile-nav-header';level2.insertBefore(header,level2.querySelector('.mobile-search-wrap'));}
  header.innerHTML=`<button class="mobile-back-btn" id="mob-back-to-l1">← Back</button><span class="mobile-nav-title">${escHtml(loaded.name)}</span><span class="mobile-nav-count">${loaded.subfolderCount||0}</span>`;
  header.querySelector('#mob-back-to-l1').addEventListener('click',()=>showMobileLevel(1));
  const searchEl=$('mob-search-input'); searchEl.value='';
  searchEl.oninput=()=>{const q=searchEl.value.toLowerCase().trim(); renderMobileSubfolders(loaded,q);};
  renderMobileSubfolders(loaded,'');
  showMobileLevel(2);
  // Background scan level 3 for this folder
  backgroundScanLevel3(mf.id, vaultMode);
}

function renderMobileSubfolders(mf, query) {
  const container=$('mob-subfolder-list'); container.innerHTML='';
  if (!mf.subfolders){container.innerHTML='<div class="bank-pane-empty" style="padding:1.5rem;"><div class="bank-pane-empty-icon">⏳</div>Loading…</div>';return;}
  const filtered=query?mf.subfolders.filter(sf=>sf.name.toLowerCase().includes(query)):mf.subfolders;
  if (!filtered.length){container.innerHTML='<div class="bank-pane-empty" style="padding:1.5rem;"><div class="bank-pane-empty-icon">📭</div>No subfolders found.</div>';return;}
  filtered.forEach(sf=>{
    const row=document.createElement('div'); row.className='mobile-subfolder-row';
    row.innerHTML=`<span class="mobile-subfolder-row-name">${escHtml(sf.name)}</span><span class="mobile-subfolder-row-count">${sf.bankCount??'…'}</span><span class="mobile-subfolder-row-chevron">›</span>`;
    row.addEventListener('click',async()=>{ const currentMf=getCurrentFolders().find(f=>f.id===mobMainFolderId); if(currentMf) await openMobileLevel3(currentMf,sf); });
    container.appendChild(row);
  });
}

async function openMobileLevel3(mf, sf) {
  mobSubfolderId=sf.id;
  const level3=$('mob-level3');
  let header=level3.querySelector('.mobile-nav-header');
  if(!header){header=document.createElement('div');header.className='mobile-nav-header';level3.insertBefore(header,level3.querySelector('.mobile-bank-header'));}
  header.innerHTML=`<button class="mobile-back-btn" id="mob-back-to-l2">← Back</button><span class="mobile-nav-title">${escHtml(sf.name)}</span><span class="mobile-nav-count">${sf.bankCount??'…'}</span>`;
  header.querySelector('#mob-back-to-l2').addEventListener('click',()=>{ const currentMf=getCurrentFolders().find(f=>f.id===mobMainFolderId); if(currentMf) openMobileLevel2(currentMf); else showMobileLevel(1); });
  $('mob-subfolder-title').textContent=sf.name;
  showMobileLevel(3);
  if (!sf.banks) {
    $('bank-pane-mobile').innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">⏳</div>Loading banks…</div>';
    await ensureLevel3(sf.id, mf.id);
    const updatedMf=getCurrentFolders().find(f=>f.id===mf.id);
    const updatedSf=updatedMf?.subfolders?.find(s=>s.id===sf.id);
    if (updatedSf) { renderMobileBankList(updatedSf); updateMobileSelectAllBtn(updatedSf); }
  } else { renderMobileBankList(sf); updateMobileSelectAllBtn(sf); }
}

function renderMobileBankList(sf) {
  const pane=$('bank-pane-mobile'); pane.innerHTML='';
  const banks=sf.banks||[];
  if (!banks.length){pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📭</div>No banks in this subfolder.</div>';return;}
  const list=document.createElement('div'); list.className='bank-list';
  banks.forEach(b=>appendBankItem(list,b)); pane.appendChild(list);
}

function toggleMobileSelectAll() {
  const mf=mobMainFolderId?getCurrentFolders().find(f=>f.id===mobMainFolderId):null;
  const sf=mf&&mobSubfolderId?mf.subfolders?.find(s=>s.id===mobSubfolderId):null;
  if (!sf||!sf.banks?.length) return;
  const allSel=sf.banks.every(b=>selectedIds.has(b.id));
  sf.banks.forEach(b=>{ allSel?selectedIds.delete(b.id):selectedIds.add(b.id); if(!allSel)selectedBankCache[b.id]=b; else delete selectedBankCache[b.id]; });
  renderMobileBankList(sf); updateMobileSelectAllBtn(sf); updateStartBtn(); updateTray();
}

function updateMobileSelectAllBtn(sf) {
  const btn=$('mob-select-all-btn');
  if (!sf||!sf.banks?.length){btn.classList.add('hidden-btn');return;}
  btn.classList.remove('hidden-btn');
  btn.textContent=sf.banks.every(b=>selectedIds.has(b.id))?'Deselect All':'Select All';
}

function showMobileLevel(n) {
  $('mob-level1').classList.toggle('hidden',n!==1);
  $('mob-level2').classList.toggle('hidden',n!==2);
  $('mob-level3').classList.toggle('hidden',n!==3);
}


// ══════════════════════════════════════════════════════════════
//  BANK ITEM (shared)
// ══════════════════════════════════════════════════════════════
function appendBankItem(container, bank) {
  const isSel=selectedIds.has(bank.id), isAdmin=currentRole==='admin', isPriv=!!bank._isPrivate;
  const item=document.createElement('div');
  item.className='bank-item'+(isSel?' selected':'')+(isPriv?' private-item':'');
  item.dataset.id=bank.id;
  const qLabel=bank.questions?bank.questions.length+' questions':'tap to load';
  const metaLabel=isAdmin?`${qLabel} · Added ${bank.addedAt}`:qLabel;
  let actions='';
  if(isAdmin){
    if(isPriv) actions=`<div class="bank-actions"><button class="bank-action-btn publish" title="Publish">🌐</button><button class="bank-action-btn delete" title="Delete">🗑</button></div>`;
    else actions=`<div class="bank-actions"><button class="bank-action-btn unpublish" title="Move to Vault">📥</button><button class="bank-action-btn delete" title="Delete">🗑</button></div>`;
  }
  item.innerHTML=`<div class="bank-checkbox">${isSel?'✓':''}</div><div class="bank-icon">${isPriv?'🔒':'📋'}</div><div class="bank-info"><div class="bank-name">${escHtml(bank.name)}</div><div class="bank-meta">${metaLabel}</div></div>${actions}`;
  item.addEventListener('click',e=>{ if(e.target.closest('.bank-actions'))return; toggleBank(bank); });
  if(isAdmin){
    const pb=item.querySelector('.bank-action-btn.publish'), ub=item.querySelector('.bank-action-btn.unpublish'), db=item.querySelector('.bank-action-btn.delete');
    if(pb) pb.addEventListener('click',e=>{e.stopPropagation();promptPublish(bank.id,bank.name);});
    if(ub) ub.addEventListener('click',e=>{e.stopPropagation();promptUnpublish(bank.id,bank.name);});
    if(db) db.addEventListener('click',e=>{e.stopPropagation();promptDeleteBank(bank.id,bank.name);});
  }
  if(!isPriv||(isPriv&&isAdmin)){
    item.addEventListener('contextmenu',e=>{e.preventDefault();showFileCtxMenu(e.clientX,e.clientY,bank.id,bank.name,isPriv);});
    let pt=null;
    item.addEventListener('touchstart',e=>{pt=setTimeout(()=>{const t=e.touches[0];showFileCtxMenu(t.clientX,t.clientY,bank.id,bank.name,isPriv);},600);},{passive:true});
    item.addEventListener('touchend',()=>{clearTimeout(pt);pt=null;});
    item.addEventListener('touchmove',()=>{clearTimeout(pt);pt=null;});
  }
  container.appendChild(item);
}

function toggleBank(bank) {
  if (selectedIds.has(bank.id)) { selectedIds.delete(bank.id); delete selectedBankCache[bank.id]; }
  else { selectedIds.add(bank.id); selectedBankCache[bank.id]=bank; }
  // Partial DOM update — no full re-render
  document.querySelectorAll(`.bank-item[data-id="${bank.id}"]`).forEach(el=>{
    const isSel=selectedIds.has(bank.id);
    el.classList.toggle('selected',isSel);
    const chk=el.querySelector('.bank-checkbox'); if(chk) chk.textContent=isSel?'✓':'';
  });
  updateStartBtn(); updateSelectAllBtn();
  const mf=mobMainFolderId?getCurrentFolders().find(f=>f.id===mobMainFolderId):null;
  updateMobileSelectAllBtn(mf&&mobSubfolderId?mf.subfolders?.find(s=>s.id===mobSubfolderId):null);
  updateTray();
}


// ══════════════════════════════════════════════════════════════
//  TRAY + START
// ══════════════════════════════════════════════════════════════
function updateStartBtn() { const ok=selectedIds.size>0; $('start-btn').disabled=!ok; $('mobile-start-btn').disabled=!ok; }

function updateTray() {
  const tray=$('selected-tray');
  const sel=Array.from(selectedIds).map(id=>selectedBankCache[id]).filter(Boolean);
  if (!sel.length){tray.classList.add('empty');tray.classList.remove('expanded');return;}
  tray.classList.remove('empty');
  const chips=$('tray-chips'); chips.innerHTML='';
  sel.slice(0,3).forEach(b=>{const c=document.createElement('span');c.className='tray-chip';c.textContent=b.name;c.title=b.name;chips.appendChild(c);});
  if (sel.length>3){const m=document.createElement('span');m.className='tray-more';m.textContent=`+${sel.length-3} more`;chips.appendChild(m);}
  const inner=$('tray-drawer-inner'); inner.innerHTML='';
  sel.forEach(b=>{
    const item=document.createElement('div'); item.className='tray-drawer-item';
    item.innerHTML=`<span style="font-size:.8rem;flex-shrink:0;">${b._isPrivate?'🔒':'📋'}</span><span class="tray-drawer-item-name">${escHtml(b.name)}</span><button class="tray-drawer-remove" data-id="${b.id}">✕</button>`;
    item.querySelector('.tray-drawer-remove').addEventListener('click',e=>{
      e.stopPropagation(); selectedIds.delete(b.id); delete selectedBankCache[b.id];
      document.querySelectorAll(`.bank-item[data-id="${b.id}"]`).forEach(el=>{el.classList.remove('selected');const chk=el.querySelector('.bank-checkbox');if(chk)chk.textContent='';});
      updateStartBtn(); updateSelectAllBtn(); updateTray();
    });
    inner.appendChild(item);
  });
}

function toggleTray() { $('selected-tray').classList.toggle('expanded'); }


// ══════════════════════════════════════════════════════════════
//  GAS HELPERS
// ══════════════════════════════════════════════════════════════
async function gasGet(params) { const url=new URL(GAS_URL); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v)); return (await fetch(url.toString())).json(); }
async function gasPost(params, body) { const url=new URL(GAS_URL); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v)); return (await fetch(url.toString(),{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body)})).json(); }


// ══════════════════════════════════════════════════════════════
//  PUBLISH / UNPUBLISH / DELETE
// ══════════════════════════════════════════════════════════════
function refreshPublishFolderSelect() {
  const sel=$('publish-folder-select'); sel.innerHTML='<option value="">📂 Ungrouped (root)</option>';
  publicFolders.forEach(mf=>{
    (mf.subfolders||[]).filter(sf=>!sf.id.startsWith('_ungrouped')).forEach(sf=>{
      const o=document.createElement('option'); o.value=sf.id; o.textContent=`📁 ${mf.name} › ${sf.name}`; sel.appendChild(o);
    });
  });
}

function promptPublish(id,name){pendingPublishId=id;$('publish-modal-desc').textContent=`Where should "${name}" go in the public Drive?`;$('publish-modal').classList.add('open');}
async function doPublishBank() {
  if(!pendingPublishId) return;
  const fid=$('publish-folder-select').value||'';
  $('publish-modal').classList.remove('open');
  try {
    const data=await withLoader('Publishing bank…',()=>gasPost({action:'publish'},{fileId:pendingPublishId,targetFolderId:fid,role:currentRole}));
    if(data.error) showErr('Publish failed: '+data.error);
    else { showToast('🌐 Bank published!',2800,'success'); _moveBankBetweenDrives(pendingPublishId); _rerenderCurrentView(); updateTray(); updateStartBtn(); }
  } catch { showErr('Network error.'); } finally { pendingPublishId=null; }
}

function promptUnpublish(id,name){pendingUnpublishId=id;$('unpublish-modal-desc').textContent=`"${name}" will move back to the Vault archive.`;$('unpublish-modal').classList.add('open');}
async function doUnpublishBank() {
  if(!pendingUnpublishId) return;
  $('unpublish-modal').classList.remove('open');
  try {
    const data=await withLoader('Moving to vault…',()=>gasPost({action:'unpublish'},{fileId:pendingUnpublishId,role:currentRole}));
    if(data.error) showErr('Unpublish failed: '+data.error);
    else { showToast('📥 Moved to Vault archive',2800,'success'); _moveBankBetweenDrives(pendingUnpublishId); _rerenderCurrentView(); updateTray(); updateStartBtn(); }
  } catch { showErr('Network error.'); } finally { pendingUnpublishId=null; }
}

function promptDeleteBank(id,name){pendingDeleteId=id;$('delete-bank-desc').textContent=`"${name}" will be permanently removed.`;$('delete-bank-modal').classList.add('open');}
async function doDeleteBank() {
  if(!pendingDeleteId) return;
  $('delete-bank-modal').classList.remove('open');
  try {
    const data=await withLoader('Deleting bank…',()=>gasPost({action:'delete'},{fileId:pendingDeleteId,role:currentRole}));
    if(data.error) showErr('Delete failed: '+data.error);
    else { showToast('🗑 Bank deleted',2800,'success'); _removeBankLocally(pendingDeleteId); _rerenderCurrentView(); updateTray(); updateStartBtn(); }
  } catch { showErr('Network error.'); } finally { pendingDeleteId=null; }
}


// ══════════════════════════════════════════════════════════════
//  FILE CONTEXT MENU
// ══════════════════════════════════════════════════════════════
function showFileCtxMenu(x,y,fileId,fileName,isPrivate=false){
  ctxFileId=fileId; ctxFileName=fileName;
  const menu=$('file-ctx-menu'), isAdmin=currentRole==='admin';
  const ti=$('ctx-file-transfer'); if(ti) ti.style.display=(!isPrivate||isAdmin)?'':'none';
  $('ctx-file-remove').textContent=isAdmin?'🗑️ Delete File':'🗂️ Remove File';
  const ri=$('ctx-file-remove'); if(ri) ri.style.display=(!isPrivate||isAdmin)?'':'none';
  menu.classList.remove('hidden');
  const mw=170, mh=isPrivate?55:110;
  menu.style.left=(x+mw>window.innerWidth?x-mw:x)+'px';
  menu.style.top=(y+mh>window.innerHeight?y-mh:y)+'px';
}
function hideFileCtxMenu(){$('file-ctx-menu').classList.add('hidden');}

function openRenameFileModal(){$('rename-file-input').value=ctxFileName;$('rename-file-err').textContent='';$('rename-file-modal').classList.add('open');setTimeout(()=>{const i=$('rename-file-input');i.focus();i.select();},300);}
async function doRenameFile() {
  const name=$('rename-file-input').value.trim();
  if(!name){$('rename-file-err').textContent='Please enter a name.';return;}
  if(name===ctxFileName){$('rename-file-modal').classList.remove('open');return;}
  $('rename-file-modal').classList.remove('open');
  try {
    const data=await withLoader('Renaming file…',()=>gasPost({action:'renameFile'},{fileId:ctxFileId,fileName:name,role:currentRole,drive:vaultMode}));
    if(data.error){showErr(data.error);return;}
    showToast(`✏️ Renamed to "${name}"`,2800,'success');
    _renameBankLocally(ctxFileId, data.newName||name); _rerenderCurrentView();
  } catch { showErr('Network error.'); }
}

function openTransferFileModal(){
  pendingTransferId=ctxFileId;
  $('transfer-file-desc').textContent=`Where should "${ctxFileName}" go?`;
  const sel=$('transfer-folder-select'), isPrivateFile=vaultMode==='private';
  sel.innerHTML=`<option value="">${isPrivateFile?'🔒 Vault root':'📂 Ungrouped (root)'}</option>`;
  const sourceFolders=isPrivateFile?privateFolders:publicFolders;
  sourceFolders.forEach(mf=>{
    (mf.subfolders||[]).filter(sf=>!sf.id.startsWith('_ungrouped')).forEach(sf=>{
      const o=document.createElement('option'); o.value=sf.id; o.textContent=(isPrivateFile?'🔒 ':'📁 ')+mf.name+' › '+sf.name; sel.appendChild(o);
    });
  });
  $('transfer-file-modal').classList.add('open');
}
async function doTransferFile() {
  if(!pendingTransferId) return;
  const fid=$('transfer-folder-select').value||'';
  $('transfer-file-modal').classList.remove('open');
  try {
    const data=await withLoader('Transferring file…',()=>gasPost({action:'transferFile'},{fileId:pendingTransferId,targetFolderId:fid,role:currentRole,drive:vaultMode}));
    if(data.error){showErr('Transfer failed: '+data.error);return;}
    showToast('📂 File transferred!',2800,'success');
    _moveBankLocally(pendingTransferId,fid); _rerenderCurrentView();
  } catch { showErr('Network error.'); } finally { pendingTransferId=null; }
}

function openRemoveFileModal(){
  if(currentRole==='admin'){pendingDeleteId=ctxFileId;$('delete-bank-desc').textContent=`"${ctxFileName}" will be permanently removed.`;$('delete-bank-modal').classList.add('open');}
  else{pendingMemberRemoveId=ctxFileId;$('member-remove-desc').textContent=`"${ctxFileName}" will be removed from public view.`;$('member-remove-modal').classList.add('open');}
}
async function doMemberRemove() {
  if(!pendingMemberRemoveId) return;
  $('member-remove-modal').classList.remove('open');
  try {
    const data=await withLoader('Removing bank…',()=>gasPost({action:'memberRemove'},{fileId:pendingMemberRemoveId,role:currentRole}));
    if(data.error){showErr('Remove failed: '+data.error);return;}
    showToast('🗂️ Bank removed from public view',2800,'success');
    _removeBankLocally(pendingMemberRemoveId); _rerenderCurrentView(); updateTray(); updateStartBtn();
  } catch { showErr('Network error.'); } finally { pendingMemberRemoveId=null; }
}

function _rerenderCurrentView() {
  renderFolderCards();
  if (activeMainFolderId) {
    const mf=getCurrentFolders().find(f=>f.id===activeMainFolderId);
    if (mf&&mf.subfolders) {
      renderSubfolderList(mf);
      if (activeSubfolderId) { const sf=mf.subfolders.find(s=>s.id===activeSubfolderId); if(sf&&sf.banks) renderBankList(sf); }
    }
  }
  renderMobileLevel1();
  if (mobMainFolderId&&!$('mob-level3').classList.contains('hidden')) {
    const mf=getCurrentFolders().find(f=>f.id===mobMainFolderId);
    if(mf&&mobSubfolderId){const sf=mf.subfolders?.find(s=>s.id===mobSubfolderId);if(sf&&sf.banks)renderMobileBankList(sf);}
  }
}


// ══════════════════════════════════════════════════════════════
//  SETTINGS SYNC
// ══════════════════════════════════════════════════════════════
function syncMobileToggles(){['mastery','shuffle','auto'].forEach(k=>$('toggle-'+k).checked=$('mob-toggle-'+k).checked);['limit','qtimer','stimer'].forEach(k=>$('select-'+k).value=$('mob-select-'+k).value);}
function openSettingsModal(){['mastery','shuffle','auto'].forEach(k=>$('mob-toggle-'+k).checked=$('toggle-'+k).checked);['limit','qtimer','stimer'].forEach(k=>$('mob-select-'+k).value=$('select-'+k).value);$('settings-modal').classList.add('open');}


// ══════════════════════════════════════════════════════════════
//  QUIZ
// ══════════════════════════════════════════════════════════════
function parseWorkbook(ab) {
  const wb=XLSX.read(ab,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  if(rows.length<2) throw new Error('No data found.');
  const h=rows[0].map(c=>String(c).toLowerCase().trim());
  let qI=h.findIndex(c=>c==='question'||c.startsWith('q')),aI=h.findIndex(c=>c==='a'),bI=h.findIndex(c=>c==='b'),cI=h.findIndex(c=>c==='c'),dI=h.findIndex(c=>c==='d'),eI=h.findIndex(c=>c==='e'),ansI=h.findIndex(c=>c==='answer'||c==='ans'||c==='correct'),expI=h.findIndex(c=>c==='explanation'||c==='exp'||c==='reason');
  if(qI<0)qI=0;if(aI<0)aI=1;if(bI<0)bI=2;if(cI<0)cI=3;if(dI<0)dI=4;if(eI<0)eI=5;if(ansI<0)ansI=6;if(expI<0)expI=7;
  const parsed=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i],q=String(r[qI]||'').trim(),ca=String(r[aI]||'').trim(),cb=String(r[bI]||'').trim(),cc=String(r[cI]||'').trim(),cd=String(r[dI]||'').trim(),ce=String(r[eI]||'').trim(),ans=String(r[ansI]||'').trim().toUpperCase().charAt(0),exp=String(r[expI]||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
    if(!q||!ca||!ans) continue;
    const choices=[{letter:'A',text:ca}];
    if(cb)choices.push({letter:'B',text:cb});if(cc)choices.push({letter:'C',text:cc});if(cd)choices.push({letter:'D',text:cd});if(ce)choices.push({letter:'E',text:ce});
    parsed.push({question:q,choices,answer:ans,type:choices.length===2?'True / False':'MCQ',explanation:exp});
  }
  if(!parsed.length) throw new Error('No valid questions found.');
  return parsed;
}

function shuffleChoices(q){const ct=q.choices.find(c=>c.letter===q.answer)?.text;const s=[...q.choices].sort(()=>Math.random()-.5).map((c,i)=>({...c,letter:String.fromCharCode(65+i)}));return{...q,choices:s,answer:s.find(c=>c.text===ct)?.letter||q.answer};}

async function startQuiz() {
  const sel=Array.from(selectedIds).map(id=>selectedBankCache[id]).filter(Boolean);
  if(!sel.length){showErr('Select at least one bank.');return;}
  $('start-btn').disabled=true; $('mobile-start-btn').disabled=true;
  try {
    for(const bank of sel){
      if(!bank.questions){
        showLoader(`Loading "${bank.name}"…`);
        bank.questions=await fetchBankQuestions(bank);
        hideLoader();
        document.querySelectorAll(`.bank-item[data-id="${bank.id}"] .bank-meta`).forEach(mc=>mc.textContent=bank.questions.length+' questions · Added '+bank.addedAt);
      }
    }
  } catch(err){hideLoader();showErr('Could not load bank: '+err.message);$('start-btn').disabled=false;$('mobile-start-btn').disabled=false;return;}
  $('start-btn').disabled=false; $('mobile-start-btn').disabled=false;
  clearSavedSession();
  _beginSession(sel.flatMap(b=>b.questions.map(q=>({...q,_bank:b.name}))));
}

async function fetchBankQuestions(bank){
  const data=await gasGet({action:'get',fileId:bank.id});
  if(data.error) throw new Error(data.error);
  const bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));
  return parseWorkbook(bytes.buffer);
}

function _beginSession(source){
  const sh=$('toggle-shuffle').checked;
  let qs=sh?[...source].sort(()=>Math.random()-.5):[...source];
  const lim=parseInt($('select-limit').value)||0; if(lim>0) qs=qs.slice(0,lim);
  qs=qs.map(q=>shuffleChoices(q));
  totalUniqueQuestions=qs.length; sessionQuestions=qs; window._sessionSource=qs.slice();
  currentIdx=0;correctCount=0;wrongCount=0;sessionResults=[];wrongPool=[];retryCounts={};
  stopQuestionTimer();stopSessionTimer();showPage('page-exam');startSessionTimer();renderQuestion();
}

function renderQuestion(){
  const q=sessionQuestions[currentIdx], mastery=$('toggle-mastery').checked;
  const tot=mastery?totalUniqueQuestions:sessionQuestions.length, cur=mastery?correctCount+1:currentIdx+1;
  const pct=mastery?Math.round((correctCount/totalUniqueQuestions)*100):Math.round((currentIdx/sessionQuestions.length)*100);
  $('prog-cur').textContent=cur; $('prog-total').textContent=tot; $('prog-pct').textContent=pct+'%'; $('prog-fill').style.width=pct+'%';
  $('hdr-c').textContent=correctCount+' ✓'; $('hdr-w').textContent=wrongCount+' ✗';
  $('score-chips').style.display=mastery?'none':'flex';
  const card=$('question-card'); card.innerHTML=''; card.style.animation='none'; void card.offsetWidth; card.style.animation='';
  const meta=document.createElement('div'); meta.className='question-meta';
  meta.innerHTML=`<span>Question ${cur} of ${tot}</span><span class="q-type-badge">${q.type}</span>${mastery?'<span class="mastery-badge">⚡ Mastery</span>':''}${q._bank?`<span class="q-bank-badge">📋 ${escHtml(q._bank)}</span>`:''}`;
  card.appendChild(meta);
  const qt=document.createElement('div'); qt.className='question-text'; qt.textContent=q.question; card.appendChild(qt);
  const ce=document.createElement('div'); ce.className='choices';
  q.choices.forEach(c=>{const btn=document.createElement('button');btn.className='choice-btn';btn.innerHTML=`<div class="choice-letter">${c.letter}</div><div class="choice-text">${escHtml(c.text)}</div>`;btn.addEventListener('click',()=>submitAnswer(c.letter,btn,q,card));ce.appendChild(btn);});
  card.appendChild(ce); startQuestionTimer(q,card);
}

function clearAutoAdvance(){if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}}

function submitAnswer(sel,btnEl,q,card){
  clearAutoAdvance(); stopQuestionTimer();
  const ok=sel===q.answer, autoOn=$('toggle-auto').checked, mastery=$('toggle-mastery').checked;
  card.querySelectorAll('.choice-btn').forEach(b=>{b.disabled=true;if(b.querySelector('.choice-letter').textContent===q.answer)b.classList.add('correct');});
  if(!ok) btnEl.classList.add('wrong');
  if(ok)correctCount++;else{wrongCount++;wrongPool.push(q);if(mastery)retryCounts[q.question]=(retryCounts[q.question]||0)+1;}
  sessionResults.push({q,selected:sel,isCorrect:ok});
  $('hdr-c').textContent=correctCount+' ✓'; $('hdr-w').textContent=wrongCount+' ✗';
  const fb=document.createElement('div'); fb.className='answer-feedback '+(ok?'correct':'wrong'); fb.textContent=ok?'✓ Correct':'✗ Incorrect'; card.appendChild(fb);
  if(q.explanation&&!autoOn){const rv=document.createElement('div');rv.className='answer-reveal '+(ok?'reveal-correct':'reveal-wrong');rv.innerHTML=`<div class="reveal-body"><span style="font-size:.7rem;font-weight:600;font-family:'Sora',sans-serif;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;">Explanation</span><span class="exp-text"></span></div>`;rv.querySelector('.exp-text').textContent=q.explanation;card.appendChild(rv);}
  if(mastery&&!ok) sessionQuestions.push(shuffleChoices(q));
  currentIdx++; saveSession(); currentIdx--;
  const last=currentIdx+1>=sessionQuestions.length;
  const advance=()=>{currentIdx++;last?(clearSavedSession(),showSummary()):renderQuestion();};
  if(autoOn){
    const bw=document.createElement('div');bw.className='auto-bar-wrap';const bf=document.createElement('div');bf.className='auto-bar-fill';bw.appendChild(bf);card.appendChild(bw);
    const secs=ok?AUTO_ADVANCE_CORRECT_SECS:AUTO_ADVANCE_WRONG_SECS;
    requestAnimationFrame(()=>{bf.style.transition=`width ${secs}s linear`;bf.style.width='0%';});
    autoTimer=setTimeout(advance,secs*1000);
  } else {
    const nb=document.createElement('button');nb.className='next-btn show';nb.textContent=last?'See Results →':'Next Question →';nb.addEventListener('click',advance);card.appendChild(nb);
  }
}

function showSummary(){
  stopQuestionTimer(); stopSessionTimer(); showPage('page-summary');
  const mastery=$('toggle-mastery').checked, total=totalUniqueQuestions;
  const firstAttemptMap=new Map();
  sessionResults.forEach(r=>{if(!firstAttemptMap.has(r.q.question))firstAttemptMap.set(r.q.question,r);});
  const firstAttempts=[...firstAttemptMap.values()];
  const ftCorrect=firstAttempts.filter(r=>r.isCorrect).length, ftWrong=firstAttempts.filter(r=>!r.isCorrect).length;
  const ftPct=total>0?Math.round((ftCorrect/total)*100):0, pct=ftPct;
  const c=2*Math.PI*45, ring=$('score-ring');
  ring.style.strokeDasharray=c; ring.style.strokeDashoffset=c;
  setTimeout(()=>{ring.style.strokeDashoffset=c-(pct/100)*c;ring.style.stroke=pct>=80?'#4ade80':pct>=60?'#7c6af7':'#f87171';},100);
  $('sum-pct').textContent=pct+'%'; $('score-ring-label-text').textContent=mastery?'1st Try':'Score';
  if(mastery){$('sum-title').textContent='🏆 All Mastered!';$('sum-sub').textContent=`${total} questions mastered in ${sessionResults.length} attempts`;$('sum-correct').textContent=total;$('label-correct').textContent='Mastered';$('sum-wrong').textContent=sessionResults.length-total;$('label-wrong').textContent='Retries';$('sum-total').textContent=ftPct+'%';$('label-total').textContent='Accuracy';}
  else{$('sum-title').textContent=pct===100?'Perfect score!':pct>=80?'Great work!':pct>=60?'Good effort':'Keep practicing';$('sum-sub').textContent=`${ftCorrect} of ${total} correct`;$('sum-correct').textContent=ftCorrect;$('label-correct').textContent='Correct';$('sum-wrong').textContent=ftWrong;$('label-wrong').textContent='Incorrect';$('sum-total').textContent=total;$('label-total').textContent='Total';}
  buildWeakTopics();
  const wt=$('weak-topics-toggle'), wb=$('weak-topics-body');
  wt.onclick=()=>{const open=wt.classList.toggle('open');wb.style.display=open?'block':'none';wt.querySelector('.weak-chevron').style.transform=open?'rotate(180deg)':'rotate(0deg)';};
  const list=$('review-list'); list.innerHTML='';
  const seen=new Set(), uniq=[];
  sessionResults.forEach(r=>{if(!seen.has(r.q.question)){seen.add(r.q.question);uniq.push([...sessionResults].reverse().find(x=>x.q.question===r.q.question));}});
  uniq.forEach((r,i)=>{
    const cc=r.q.choices.find(c=>c.letter===r.q.answer), sc=r.q.choices.find(c=>c.letter===r.selected);
    const ah=r.isCorrect?`<div class="review-ans-block"><div class="review-ans-row"><span class="ca">✓ ${r.q.answer} — ${escHtml(cc?.text||'')}</span></div></div>`:`<div class="review-ans-block"><div class="review-ans-row">Your answer: <span class="wa">${r.selected} — ${escHtml(sc?.text||'')}</span></div><div class="review-ans-row">Correct: <span class="ca">${r.q.answer} — ${escHtml(cc?.text||'')}</span></div></div>`;
    const retries=retryCounts[r.q.question]||0, retryBadge=retries>0?`<span class="retry-badge ${retries>1?'retry-high':''}">${retries} ${retries===1?'retry':'retries'}</span>`:'';
    const item=document.createElement('div'); item.className='review-item'+(retries>1?' retried':'');
    item.innerHTML=`<div class="review-dot ${r.isCorrect?'c':'w'}"></div><div style="flex:1;min-width:0;"><div class="review-q" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;"><span style="flex:1;">${i+1}. ${escHtml(r.q.question)}</span>${retryBadge}</div>${ah}</div>`;
    list.appendChild(item);
  });
}

async function retakeSession(){
  clearAutoAdvance(); clearSavedSession();
  const sel=Array.from(selectedIds).map(id=>selectedBankCache[id]).filter(Boolean);
  const fromMemory=sel.flatMap(b=>b.questions?b.questions.map(q=>({...q,_bank:b.name})):[]);
  if(fromMemory.length){_beginSession(fromMemory);return;}
  const source=window._sessionSource;
  if(source&&source.length){_beginSession(source);return;}
  showErr('Could not retake — please select banks and start a new session.');
}

function openQuitModal(){$('quit-modal').classList.add('open');}
function closeQuitModal(){$('quit-modal').classList.remove('open');}
function confirmQuit(){clearAutoAdvance();stopQuestionTimer();stopSessionTimer();closeQuitModal();goLanding();}
function goLanding(){showPage('page-landing');}
function showPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));$(id).classList.remove('hidden');}


// ══════════════════════════════════════════════════════════════
//  TIMERS
// ══════════════════════════════════════════════════════════════
function syncTimerBar(){const qa=!$('question-timer-wrap').classList.contains('hidden'),sa=!$('session-timer-wrap').classList.contains('hidden');$('timer-bar').classList.toggle('hidden',!(qa||sa));const sep=$('timer-bar-sep');if(sep)sep.classList.toggle('hidden',!(qa&&sa));}
function startQuestionTimer(q,card){const secs=parseInt($('select-qtimer').value)||0;if(!secs)return;questionTimeLeft=secs;updateQuestionTimerDisplay();$('question-timer-wrap').classList.remove('hidden');syncTimerBar();questionTimerInterval=setInterval(()=>{questionTimeLeft--;updateQuestionTimerDisplay();if(questionTimeLeft<=0){stopQuestionTimer();const btns=card.querySelectorAll('.choice-btn:not(:disabled)');if(btns.length){const wb=Array.from(btns).find(b=>b.querySelector('.choice-letter').textContent!==q.answer)||btns[0];wb.click();}}},1000);}
function stopQuestionTimer(){clearInterval(questionTimerInterval);questionTimerInterval=null;const w=$('question-timer-wrap');if(w)w.classList.add('hidden');syncTimerBar();}
function updateQuestionTimerDisplay(){const el=$('question-timer-val');if(!el)return;el.textContent=questionTimeLeft+'s';el.style.color=questionTimeLeft<=5?'var(--wrong)':questionTimeLeft<=10?'var(--gold)':'var(--text)';}
function startSessionTimer(){const mins=parseInt($('select-stimer').value)||0;if(!mins)return;sessionTimeLeft=mins*60;updateSessionTimerDisplay();$('session-timer-wrap').classList.remove('hidden');syncTimerBar();sessionTimerInterval=setInterval(()=>{sessionTimeLeft--;updateSessionTimerDisplay();saveSession();if(sessionTimeLeft<=0){stopSessionTimer();clearSavedSession();showSummary();}},1000);}
function stopSessionTimer(){clearInterval(sessionTimerInterval);sessionTimerInterval=null;const w=$('session-timer-wrap');if(w)w.classList.add('hidden');syncTimerBar();}
function updateSessionTimerDisplay(){const el=$('session-timer-val');if(!el)return;const m=Math.floor(sessionTimeLeft/60),s=sessionTimeLeft%60;el.textContent=m+':'+(s<10?'0':'')+s;el.style.color=sessionTimeLeft<=30?'var(--wrong)':sessionTimeLeft<=60?'var(--gold)':'var(--text)';}


// ══════════════════════════════════════════════════════════════
//  WEAK TOPICS
// ══════════════════════════════════════════════════════════════
function buildWeakTopics(){
  const bankMap={}, firstAttemptMap=new Map();
  sessionResults.forEach(r=>{if(!firstAttemptMap.has(r.q.question))firstAttemptMap.set(r.q.question,r);});
  firstAttemptMap.forEach(r=>{const bank=r.q._bank||'Unknown';if(!bankMap[bank])bankMap[bank]={correct:0,total:0};bankMap[bank].total++;if(r.isCorrect)bankMap[bank].correct++;});
  const banks=Object.entries(bankMap).map(([name,d])=>({name,pct:d.total?Math.round((d.correct/d.total)*100):0}));
  banks.sort((a,b)=>a.pct-b.pct);
  const container=$('weak-topics-body'); container.innerHTML='';
  if(!banks.length){const e=document.createElement('div');e.style.cssText='font-size:0.8rem;color:var(--text-dim);padding:0.25rem 0;';e.textContent='No data available.';container.appendChild(e);return;}
  banks.forEach(b=>{
    const color=b.pct>=80?'var(--correct)':b.pct>=60?'var(--gold)':'var(--wrong)';
    const row=document.createElement('div'); row.className='weak-row';
    row.innerHTML=`<div class="weak-row-meta"><span class="weak-name">${escHtml(b.name)}</span><span class="weak-pct" style="color:${color}">${b.pct}%</span></div><div class="weak-bar-bg"><div class="weak-bar-fill" style="width:${b.pct}%;background:${color}"></div></div>`;
    container.appendChild(row);
  });
}


// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg,dur=2800,type=''){const t=$('toast');t.textContent=msg;t.className='toast show'+(type?' '+type:'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),dur);}
function showErr(msg){const e=$('err-msg');e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',4500);}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}