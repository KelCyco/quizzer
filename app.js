const GAS_URL   = 'https://script.google.com/macros/s/AKfycbyItj-3QhjGvVu4H0wAPLdMWijAgTmUN75v1cFoGj7Wm6vFUJl6AuyCFIRM-QcIF2g/exec';
const GAS_READY = !!GAS_URL && !GAS_URL.includes('PASTE_YOUR');
const DEVTOOLS_BLOCK = true;
const AUTO_ADVANCE_CORRECT_SECS = 1;
const AUTO_ADVANCE_WRONG_SECS   = 2;

let publicFolders=[], privateFolders=[], allBanks=[];
let selectedIds=new Set(), activeTabId=null, searchQuery='', vaultMode='public';
let sessionQuestions=[], sessionResults=[], wrongPool=[];
let currentIdx=0, correctCount=0, wrongCount=0, autoTimer=null, totalUniqueQuestions=0;
let retryCounts={};
let currentRole=null;
let pendingDeleteId=null, pendingPublishId=null, pendingUnpublishId=null;

const $=id=>document.getElementById(id);

document.addEventListener('contextmenu',e=>{if(DEVTOOLS_BLOCK)e.preventDefault();});
document.addEventListener('keydown',e=>{
  if(!DEVTOOLS_BLOCK)return;
  const k=e.key;
  if(k==='F12'){e.preventDefault();return;}
  if(e.ctrlKey&&e.shiftKey&&(k==='I'||k==='i'||k==='J'||k==='j'||k==='C'||k==='c'||k==='K'||k==='k')){e.preventDefault();return;}
  if(e.ctrlKey&&(k==='u'||k==='U'||k==='p'||k==='P'||k==='s'||k==='S')){e.preventDefault();return;}
});

window.addEventListener('beforeprint',e=>e.preventDefault());

window.addEventListener('DOMContentLoaded',()=>{
  const params=new URLSearchParams(window.location.search);
  setTimeout(()=>{
    $('page-splash').classList.add('fade-out');
    setTimeout(()=>{
      $('page-splash').classList.add('hidden');
      showPasswordGate();
    },600);
  },1800);

  $('refresh-btn').addEventListener('click',()=>loadAllFolders());
  $('add-bank-btn').addEventListener('click',()=>$('file-input').click());
  $('file-input').addEventListener('change',e=>{handleFiles(e.target.files);e.target.value='';});
  $('start-btn').addEventListener('click',startQuiz);
  $('mobile-start-btn').addEventListener('click',()=>{syncMobileToggles();startQuiz();});
  $('mobile-settings-btn').addEventListener('click',openSettingsModal);
  $('settings-done-btn').addEventListener('click',()=>{syncMobileToggles();$('settings-modal').classList.remove('open');});
  $('settings-modal').addEventListener('click',e=>{if(e.target===$('settings-modal')){syncMobileToggles();$('settings-modal').classList.remove('open');}});
  $('quit-btn').addEventListener('click',openQuitModal);
  $('quit-keep').addEventListener('click',closeQuitModal);
  $('quit-confirm').addEventListener('click',confirmQuit);
  $('quit-modal').addEventListener('click',e=>{if(e.target===$('quit-modal'))closeQuitModal();});
  $('btn-landing').addEventListener('click',goLanding);
  $('btn-retake').addEventListener('click',retakeSession);
  $('password-submit').addEventListener('click',submitPassword);
  $('password-input').addEventListener('keydown',e=>{if(e.key==='Enter')submitPassword();});
  $('search-input').addEventListener('input',e=>{searchQuery=e.target.value.toLowerCase().trim();handleSearch();});
  $('select-all-btn').addEventListener('click',toggleSelectAll);
  $('tray-collapsed').addEventListener('click',toggleTray);
  $('btn-mode-public').addEventListener('click',()=>setVaultMode('public'));
  $('btn-mode-private').addEventListener('click',()=>setVaultMode('private'));
  $('delete-keep-btn').addEventListener('click',()=>$('delete-bank-modal').classList.remove('open'));
  $('new-folder-btn').addEventListener('click',openNewFolderModal);
  $('new-folder-cancel').addEventListener('click',()=>$('new-folder-modal').classList.remove('open'));
  $('new-folder-confirm').addEventListener('click',doCreateFolder);
  $('new-folder-input').addEventListener('keydown',e=>{if(e.key==='Enter')doCreateFolder();});
  $('new-folder-modal').addEventListener('click',e=>{if(e.target===$('new-folder-modal'))$('new-folder-modal').classList.remove('open');});
  $('delete-confirm-btn').addEventListener('click',doDeleteBank);
  $('delete-bank-modal').addEventListener('click',e=>{if(e.target===$('delete-bank-modal'))$('delete-bank-modal').classList.remove('open');});
  $('publish-cancel-btn').addEventListener('click',()=>$('publish-modal').classList.remove('open'));
  $('publish-confirm-btn').addEventListener('click',doPublishBank);
  $('publish-modal').addEventListener('click',e=>{if(e.target===$('publish-modal'))$('publish-modal').classList.remove('open');});
  $('unpublish-cancel-btn').addEventListener('click',()=>$('unpublish-modal').classList.remove('open'));
  $('unpublish-confirm-btn').addEventListener('click',doUnpublishBank);
  $('unpublish-modal').addEventListener('click',e=>{if(e.target===$('unpublish-modal'))$('unpublish-modal').classList.remove('open');});
  $('rename-folder-cancel').addEventListener('click',()=>$('rename-folder-modal').classList.remove('open'));
  $('rename-folder-confirm').addEventListener('click',doRenameFolder);
  $('rename-folder-input').addEventListener('keydown',e=>{if(e.key==='Enter')doRenameFolder();});
  $('rename-folder-modal').addEventListener('click',e=>{if(e.target===$('rename-folder-modal'))$('rename-folder-modal').classList.remove('open');});
  $('delete-folder-cancel').addEventListener('click',()=>$('delete-folder-modal').classList.remove('open'));
  $('delete-folder-confirm').addEventListener('click',doDeleteFolder);
  $('delete-folder-modal').addEventListener('click',e=>{if(e.target===$('delete-folder-modal'))$('delete-folder-modal').classList.remove('open');});
  $('ctx-rename').addEventListener('click',()=>{hideCtxMenu();openRenameModal();});
  $('ctx-delete').addEventListener('click',()=>{hideCtxMenu();openDeleteFolderModal();});
  document.addEventListener('click',hideCtxMenu);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideCtxMenu();});
});

function applyRole(role){
  currentRole=role;
  const isAdmin=role==='admin';
  const html=isAdmin?'👑 Admin':'👤 Member';
  const cls=isAdmin?'admin':'member';
  [$('role-badge-sidebar'),$('role-badge-desktop')].forEach(el=>{el.innerHTML=html;el.className=`role-badge ${cls}`;});
  $('add-bank-btn').classList.toggle('hidden',!isAdmin);
  $('new-folder-btn').classList.toggle('hidden',!isAdmin);
  $('vault-toggle-wrap').classList.toggle('visible',isAdmin);
}

function setVaultMode(mode){
  vaultMode=mode;
  const isP=mode==='private';
  $('btn-mode-public').classList.toggle('active',!isP);
  $('btn-mode-private').classList.toggle('active',isP);
  $('btn-mode-private').classList.toggle('private-active',isP);
  $('materials-panel').classList.toggle('private-mode',isP);
  selectedIds.clear();activeTabId=null;
  allBanks=getCurrentFolders().flatMap(f=>f.banks);
  $('bank-count-badge').textContent=allBanks.length;
  renderTabs();showInitialPane();updateStartBtn();updateTray();updateSelectAllBtn();
  if(isP)refreshPublishFolderSelect();
}

function getCurrentFolders(){return vaultMode==='private'?privateFolders:publicFolders;}

function showPasswordGate(){
  $('password-modal').classList.add('open');
  $('password-err').textContent='';$('password-input').value='';
  setTimeout(()=>$('password-input').focus(),300);
}

async function submitPassword(){
  const val=$('password-input').value.trim();if(!val)return;
  $('password-submit').textContent='Checking…';$('password-submit').disabled=true;
  try{
    const data=await gasGet({action:'verify',code:val});
    if(data.ok){
      $('password-modal').classList.remove('open');
      applyRole(data.role||'member');
      $('page-landing').classList.remove('hidden');
      if(GAS_READY){$('config-banner').classList.add('hidden');loadAllFolders();}
      else $('config-banner').classList.remove('hidden');
    }else{
      const inp=$('password-input');
      inp.classList.remove('shake');void inp.offsetWidth;inp.classList.add('shake');
      $('password-err').textContent='Incorrect password. Try again.';inp.value='';
      setTimeout(()=>inp.classList.remove('shake'),400);
    }
  }catch{$('password-err').textContent='Network error. Try again.';}
  finally{$('password-submit').textContent='Unlock →';$('password-submit').disabled=false;}
}

async function loadAllFolders(){
  if(!GAS_READY)return;
  const btn=$('refresh-btn');btn.classList.add('spinning');
  try{
    const pubData=await gasGet({action:'list',drive:'public',role:currentRole||'member'});
    if(!pubData.error){
      const ex={};publicFolders.flatMap(f=>f.banks).forEach(b=>{if(b.questions)ex[b.id]=b.questions;});
      publicFolders=(pubData.folders||[]).map(f=>({...f,banks:f.banks.map(b=>({...b,questions:ex[b.id]||null}))}));
    }
    if(currentRole==='admin'){
      const privData=await gasGet({action:'list',drive:'private',role:'admin'});
      if(!privData.error){
        const ex={};privateFolders.flatMap(f=>f.banks).forEach(b=>{if(b.questions)ex[b.id]=b.questions;});
        privateFolders=(privData.folders||[]).map(f=>({...f,banks:f.banks.map(b=>({...b,questions:ex[b.id]||null,_isPrivate:true}))}));
      }
    }
    allBanks=getCurrentFolders().flatMap(f=>f.banks);
    $('bank-count-badge').textContent=allBanks.length;
    renderTabs();
    if(activeTabId&&getCurrentFolders().find(f=>f.id===activeTabId))renderBankList(activeTabId);
    else{activeTabId=null;showInitialPane();}
    updateSelectAllBtn();refreshPublishFolderSelect();
  }catch{showErr('Network error. Check your GAS URL.');}
  finally{btn.classList.remove('spinning');}
}

function renderTabs(){
  const bar=$('folder-tabs-bar');
  Array.from(bar.children).forEach(c=>{if(!c.classList.contains('tabs-spacer')&&c.id!=='select-all-btn'&&c.id!=='new-folder-btn')c.remove();});
  const spacer=bar.querySelector('.tabs-spacer');
  const isP=vaultMode==='private';
  bar.insertBefore(makeTab('_all',(isP?'🔒 All':'📚 All'),allBanks.length,isP),spacer);
  getCurrentFolders().forEach(f=>{
    const icon=f.id==='_ungrouped'?'📂 ':(isP?'🔒 ':'📁 ');
    bar.insertBefore(makeTab(f.id,icon+f.name,f.banks.length,isP),spacer);
  });
  const newFolderBtn=$('new-folder-btn');
  bar.insertBefore(newFolderBtn,spacer);
  updateSelectAllBtn();
}

function makeTab(id,label,count,isP){
  const tab=document.createElement('div');
  tab.className='folder-tab'+(id===activeTabId?' active':'')+(isP?' private-tab':'');
  tab.dataset.id=id;
  tab.innerHTML=`${escHtml(label)}<span class="tab-count">${count}</span>`;
  tab.addEventListener('click',()=>{
    if(activeTabId===id){activeTabId=null;renderTabs();showInitialPane();updateSelectAllBtn();}
    else selectTab(id);
  });
  if(id!=='_all'&&id!=='_ungrouped'){
    tab.addEventListener('contextmenu',e=>{
      if(currentRole!=='admin')return;
      e.preventDefault();
      showCtxMenu(e.clientX,e.clientY,id,label.replace(/^[^\s]+\s/,''));
    });
  }
    // Long press for mobile
  let pressTimer=null;
  tab.addEventListener('touchstart',e=>{
    if(currentRole!=='admin')return;
    pressTimer=setTimeout(()=>{
      const touch=e.touches[0];
      showCtxMenu(touch.clientX,touch.clientY,id,label.replace(/^[^\s]+\s/,''));
    },600);
  },{passive:true});
  tab.addEventListener('touchend',()=>{clearTimeout(pressTimer);pressTimer=null;});
  tab.addEventListener('touchmove',()=>{clearTimeout(pressTimer);pressTimer=null;});
  return tab;
}

function selectTab(id){
  if(searchQuery){$('search-input').value='';searchQuery='';}
  activeTabId=id;renderTabs();renderBankList(id);updateSelectAllBtn();
}

function getBanksForTab(id){
  if(id==='_all')return allBanks;
  const f=getCurrentFolders().find(f=>f.id===id);return f?f.banks:[];
}

function renderBankList(tabId){
  const banks=getBanksForTab(tabId);const pane=$('bank-pane');pane.innerHTML='';
  if(!banks.length){pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">📭</div>No banks in this folder.</div>';return;}
  const list=document.createElement('div');list.className='bank-list';
  banks.forEach(b=>appendBankItem(list,b));pane.appendChild(list);updateSelectAllBtn();
}

function appendBankItem(container,bank){
  const isSel=selectedIds.has(bank.id),isAdmin=currentRole==='admin',isPriv=!!bank._isPrivate;
  const item=document.createElement('div');
  item.className='bank-item'+(isSel?' selected':'')+(isPriv?' private-item':'');
  item.dataset.id=bank.id;
  const qLabel=bank.questions?bank.questions.length+' questions':'tap to load';
  let actions='';
  if(isAdmin){
    if(isPriv)actions=`<div class="bank-actions"><button class="bank-action-btn publish" data-id="${bank.id}" data-name="${escHtml(bank.name)}" title="Publish to public">🌐</button><button class="bank-action-btn delete" data-id="${bank.id}" title="Delete">🗑</button></div>`;
    else actions=`<div class="bank-actions"><button class="bank-action-btn unpublish" data-id="${bank.id}" data-name="${escHtml(bank.name)}" title="Move back to Vault">📥</button><button class="bank-action-btn delete" data-id="${bank.id}" title="Delete">🗑</button></div>`;
  }
  item.innerHTML=`<div class="bank-checkbox">${isSel?'✓':''}</div><div class="bank-icon">${isPriv?'🔒':'📋'}</div><div class="bank-info"><div class="bank-name">${escHtml(bank.name)}</div><div class="bank-meta">${qLabel} · Added ${bank.addedAt}</div></div>${actions}`;
  item.addEventListener('click',e=>{if(e.target.closest('.bank-actions'))return;toggleBank(bank.id);});
  if(isAdmin){
    const pb=item.querySelector('.bank-action-btn.publish');
    const ub=item.querySelector('.bank-action-btn.unpublish');
    const db=item.querySelector('.bank-action-btn.delete');
    if(pb)pb.addEventListener('click',e=>{e.stopPropagation();promptPublish(bank.id,bank.name);});
    if(ub)ub.addEventListener('click',e=>{e.stopPropagation();promptUnpublish(bank.id,bank.name);});
    if(db)db.addEventListener('click',e=>{e.stopPropagation();promptDeleteBank(bank.id,bank.name);});
  }
  container.appendChild(item);
}

function renderCurrentTab(){if(searchQuery){handleSearch();return;}if(activeTabId)renderBankList(activeTabId);else showInitialPane();}

function showInitialPane(){
  const pane=$('bank-pane');pane.innerHTML='';
  const el=document.createElement('div');el.className='bank-pane-empty';
  el.innerHTML=`<div class="bank-pane-empty-icon">${vaultMode==='private'?'🔒':'📁'}</div>Select a folder to view its banks.<span style="font-size:0.72rem;">Banks load on demand when a folder is opened.</span>`;
  pane.appendChild(el);
}

function handleSearch(){
  const pane=$('bank-pane');$('select-all-btn').classList.add('hidden-btn');
  if(!searchQuery){if(activeTabId)renderBankList(activeTabId);else showInitialPane();updateSelectAllBtn();return;}
  const res=allBanks.filter(b=>b.name.toLowerCase().includes(searchQuery));
  pane.innerHTML='';document.querySelectorAll('.folder-tab').forEach(t=>t.classList.remove('active'));
  if(!res.length){pane.innerHTML='<div class="bank-pane-empty"><div class="bank-pane-empty-icon">🔍</div>No banks match your search.</div>';updateStartBtn();return;}
  const list=document.createElement('div');list.className='bank-list';
  res.forEach(b=>appendBankItem(list,b));pane.appendChild(list);updateStartBtn();
}

function getActiveFolderBanks(){return activeTabId?getBanksForTab(activeTabId):[];}
function updateSelectAllBtn(){
  const btn=$('select-all-btn');
  if(!activeTabId||searchQuery){btn.classList.add('hidden-btn');return;}
  const banks=getActiveFolderBanks();
  if(!banks.length){btn.classList.add('hidden-btn');return;}
  btn.classList.remove('hidden-btn');
  btn.textContent=banks.every(b=>selectedIds.has(b.id))?'Deselect All':'Select All';
}
function toggleSelectAll(){
  const banks=getActiveFolderBanks();if(!banks.length)return;
  const all=banks.every(b=>selectedIds.has(b.id));
  banks.forEach(b=>all?selectedIds.delete(b.id):selectedIds.add(b.id));
  renderCurrentTab();updateStartBtn();updateSelectAllBtn();updateTray();
}
function toggleBank(id){selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id);renderCurrentTab();updateStartBtn();updateSelectAllBtn();updateTray();}
function updateStartBtn(){const ok=selectedIds.size>0&&allBanks.some(b=>selectedIds.has(b.id));$('start-btn').disabled=!ok;$('mobile-start-btn').disabled=!ok;}

function updateTray(){
  const tray=$('selected-tray'),sel=allBanks.filter(b=>selectedIds.has(b.id));
  if(!sel.length){tray.classList.add('empty');tray.classList.remove('expanded');return;}
  tray.classList.remove('empty');
  const chips=$('tray-chips');chips.innerHTML='';
  sel.slice(0,3).forEach(b=>{const c=document.createElement('span');c.className='tray-chip';c.textContent=b.name;c.title=b.name;chips.appendChild(c);});
  if(sel.length>3){const m=document.createElement('span');m.className='tray-more';m.textContent=`+${sel.length-3} more`;chips.appendChild(m);}
  const inner=$('tray-drawer-inner');inner.innerHTML='';
  sel.forEach(b=>{
    const item=document.createElement('div');item.className='tray-drawer-item';
    item.innerHTML=`<span style="font-size:.8rem;flex-shrink:0;">${b._isPrivate?'🔒':'📋'}</span><span class="tray-drawer-item-name">${escHtml(b.name)}</span><button class="tray-drawer-remove" data-id="${b.id}">✕</button>`;
    item.querySelector('.tray-drawer-remove').addEventListener('click',e=>{e.stopPropagation();selectedIds.delete(b.id);renderCurrentTab();updateStartBtn();updateSelectAllBtn();updateTray();});
    inner.appendChild(item);
  });
}
function toggleTray(){$('selected-tray').classList.toggle('expanded');}

function refreshPublishFolderSelect(){
  const sel=$('publish-folder-select');
  sel.innerHTML='<option value="">📂 Ungrouped (root)</option>';
  publicFolders.filter(f=>f.id!=='_ungrouped').forEach(f=>{
    const o=document.createElement('option');o.value=f.id;o.textContent='📁 '+f.name;sel.appendChild(o);
  });
}

function promptPublish(id,name){pendingPublishId=id;$('publish-modal-desc').textContent=`Where should "${name}" go in the public Drive?`;$('publish-modal').classList.add('open');}
async function doPublishBank(){
  if(!pendingPublishId)return;
  const fid=$('publish-folder-select').value||'';
  $('publish-confirm-btn').textContent='Publishing…';$('publish-confirm-btn').disabled=true;
  try{
    const data=await gasPost({action:'publish'},{fileId:pendingPublishId,targetFolderId:fid,role:currentRole});
    if(data.error)showErr('Publish failed: '+data.error);
    else {
      showToast('🌐 Bank published!',2800,'success');
      await loadAllFolders();}
  }catch{showErr('Network error.');}
  finally{$('publish-confirm-btn').textContent='Publish →';$('publish-confirm-btn').disabled=false;$('publish-modal').classList.remove('open');pendingPublishId=null;}
}

function promptUnpublish(id,name){pendingUnpublishId=id;$('unpublish-modal-desc').textContent=`"${name}" will move back to the Vault archive.`;$('unpublish-modal').classList.add('open');}
async function doUnpublishBank(){
  if(!pendingUnpublishId)return;
  $('unpublish-confirm-btn').textContent='Moving…';$('unpublish-confirm-btn').disabled=true;
  try{
    const data=await gasPost({action:'unpublish'},{fileId:pendingUnpublishId,role:currentRole});
    if(data.error)showErr('Unpublish failed: '+data.error);
    else{
      showToast('📥 Moved to Vault archive',2800,'success');
      selectedIds.delete(pendingUnpublishId);await loadAllFolders();updateTray();updateStartBtn();}
  }catch{showErr('Network error.');}
  finally{$('unpublish-confirm-btn').textContent='Move to Vault →';$('unpublish-confirm-btn').disabled=false;$('unpublish-modal').classList.remove('open');pendingUnpublishId=null;}
}

function promptDeleteBank(id,name){pendingDeleteId=id;$('delete-bank-desc').textContent=`"${name}" will be permanently removed.`;$('delete-bank-modal').classList.add('open');}
async function doDeleteBank(){
  if(!pendingDeleteId)return;
  $('delete-confirm-btn').textContent='Deleting…';$('delete-confirm-btn').disabled=true;
  try{
    const data=await gasPost({action:'delete'},{fileId:pendingDeleteId,role:currentRole});
    if(data.error)showErr('Delete failed: '+data.error);
    else{
      showToast('🗑 Bank deleted',2800,'success');
      selectedIds.delete(pendingDeleteId);
      await loadAllFolders();
      updateTray();
      updateStartBtn();}
  }catch{showErr('Network error.');}
  finally{$('delete-confirm-btn').textContent='Yes, delete';$('delete-confirm-btn').disabled=false;$('delete-bank-modal').classList.remove('open');pendingDeleteId=null;}
}

function handleFiles(fileList){
  if(!GAS_READY){showErr('Set GAS_URL first.');return;}
  if(currentRole!=='admin'){showErr('Upload restricted to admins.');return;}
  const files=Array.from(fileList).filter(f=>/\.(xlsx|xls|csv)$/i.test(f.name));
  if(!files.length){showErr('Upload .xlsx, .xls, or .csv files only.');return;}
  const targetFolderId=(activeTabId&&activeTabId!=='_all')?activeTabId:'';
  const targetDrive=vaultMode;
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=async e=>{
      try{
        showToast(`⏳ Uploading "${file.name}"…`,15000);
        const b64=btoa(String.fromCharCode(...new Uint8Array(e.target.result)));
        const mime=file.name.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const data=await gasPost({action:'upload'},{fileName:file.name,data:b64,mimeType:mime,folderId:targetFolderId,drive:targetDrive,role:currentRole});
        if(data.error){showErr('Upload failed: '+data.error);return;}
        showToast(`✓ "${file.name}" uploaded`,2800,'success');
        await loadAllFolders();
      }catch(err){showErr('Upload error: '+err.message);}
    };
    reader.readAsArrayBuffer(file);
  });
}

async function gasGet(params){const url=new URL(GAS_URL);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return(await fetch(url.toString())).json();}
async function gasPost(params,body){const url=new URL(GAS_URL);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return(await fetch(url.toString(),{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body)})).json();}

function syncMobileToggles(){$('toggle-mastery').checked=$('mob-toggle-mastery').checked;$('toggle-shuffle').checked=$('mob-toggle-shuffle').checked;$('toggle-auto').checked=$('mob-toggle-auto').checked;$('select-limit').value=$('mob-select-limit').value;}
function openSettingsModal(){$('mob-toggle-mastery').checked=$('toggle-mastery').checked;$('mob-toggle-shuffle').checked=$('toggle-shuffle').checked;$('mob-toggle-auto').checked=$('toggle-auto').checked;$('mob-select-limit').value=$('select-limit').value;$('settings-modal').classList.add('open');}

function parseWorkbook(ab){
  const wb=XLSX.read(ab,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  if(rows.length<2)throw new Error('No data found.');
  const h=rows[0].map(c=>String(c).toLowerCase().trim());
  let qI=h.findIndex(c=>c==='question'||c.startsWith('q')),aI=h.findIndex(c=>c==='a'),bI=h.findIndex(c=>c==='b'),cI=h.findIndex(c=>c==='c'),dI=h.findIndex(c=>c==='d'),eI=h.findIndex(c=>c==='e'),ansI=h.findIndex(c=>c==='answer'||c==='ans'||c==='correct'),expI=h.findIndex(c=>c==='explanation'||c==='exp'||c==='reason');
  if(qI<0)qI=0;if(aI<0)aI=1;if(bI<0)bI=2;if(cI<0)cI=3;if(dI<0)dI=4;if(eI<0)eI=5;if(ansI<0)ansI=6;if(expI<0)expI=7;
  const parsed=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    const q=String(r[qI]||'').trim(),ca=String(r[aI]||'').trim(),cb=String(r[bI]||'').trim(),cc=String(r[cI]||'').trim(),cd=String(r[dI]||'').trim(),ce=String(r[eI]||'').trim(),ans=String(r[ansI]||'').trim().toUpperCase().charAt(0),exp=String(r[expI]||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
    if(!q||!ca||!ans)continue;
    const choices=[{letter:'A',text:ca}];
    if(cb)choices.push({letter:'B',text:cb});if(cc)choices.push({letter:'C',text:cc});if(cd)choices.push({letter:'D',text:cd});if(ce)choices.push({letter:'E',text:ce});
    parsed.push({question:q,choices,answer:ans,type:choices.length===2?'True / False':'MCQ',explanation:exp});
  }
  if(!parsed.length)throw new Error('No valid questions found.');
  return parsed;
}
function shuffleChoices(q){const ct=q.choices.find(c=>c.letter===q.answer)?.text;const s=[...q.choices].sort(()=>Math.random()-.5).map((c,i)=>({...c,letter:String.fromCharCode(65+i)}));return{...q,choices:s,answer:s.find(c=>c.text===ct)?.letter||q.answer};}

async function startQuiz(){
  const sel=allBanks.filter(b=>selectedIds.has(b.id));if(!sel.length){showErr('Select at least one bank.');return;}
  $('start-btn').textContent='Loading…';$('start-btn').disabled=true;$('mobile-start-btn').textContent='Loading…';$('mobile-start-btn').disabled=true;
  try{
    for(const bank of sel){
      if(!bank.questions){
        showToast(`⏳ Loading "${bank.name}"…`,60000);
        bank.questions=await fetchBankQuestions(bank);
        const mc=document.querySelector(`.bank-item[data-id="${bank.id}"] .bank-meta`);
        if(mc)mc.textContent=bank.questions.length+' questions · Added '+bank.addedAt;
        showToast(`✓ "${bank.name}" loaded!`,1500,'success');
      }
    }
  }catch(err){showErr('Could not load bank: '+err.message);$('start-btn').textContent='Start Session →';$('start-btn').disabled=false;$('mobile-start-btn').textContent='Start Session →';$('mobile-start-btn').disabled=false;return;}
  $('start-btn').textContent='Start Session →';$('start-btn').disabled=false;$('mobile-start-btn').textContent='Start Session →';$('mobile-start-btn').disabled=false;
  _beginSession(sel.flatMap(b=>b.questions.map(q=>({...q,_bank:b.name}))));
}
async function fetchBankQuestions(bank){const data=await gasGet({action:'get',fileId:bank.id});if(data.error)throw new Error(data.error);const bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));return parseWorkbook(bytes.buffer);}
function _beginSession(source){const sh=$('toggle-shuffle').checked;let qs=sh?[...source].sort(()=>Math.random()-.5):[...source];const lim=parseInt($('select-limit').value)||0;if(lim>0)qs=qs.slice(0,lim);qs=qs.map(q=>shuffleChoices(q));totalUniqueQuestions=qs.length;sessionQuestions=qs;currentIdx=0;correctCount=0;wrongCount=0;sessionResults=[];wrongPool=[];retryCounts={};showPage('page-exam');renderQuestion();}

function renderQuestion(){
  const q=sessionQuestions[currentIdx],mastery=$('toggle-mastery').checked;
  const tot=mastery?totalUniqueQuestions:sessionQuestions.length,cur=mastery?correctCount+1:currentIdx+1;
  const pct=mastery?Math.round((correctCount/totalUniqueQuestions)*100):Math.round((currentIdx/sessionQuestions.length)*100);
  $('prog-cur').textContent=cur;$('prog-total').textContent=tot;$('prog-pct').textContent=pct+'%';$('prog-fill').style.width=pct+'%';
  $('hdr-c').textContent=correctCount+' ✓';$('hdr-w').textContent=wrongCount+' ✗';$('score-chips').style.display=mastery?'none':'flex';
  const card=$('question-card');card.innerHTML='';card.style.animation='none';void card.offsetWidth;card.style.animation='';
  const meta=document.createElement('div');meta.className='question-meta';
  meta.innerHTML=`<span>Question ${cur} of ${tot}</span><span class="q-type-badge">${q.type}</span>${mastery?'<span class="mastery-badge">⚡ Mastery</span>':''}${q._bank?`<span class="q-bank-badge">📋 ${escHtml(q._bank)}</span>`:''}`;
  card.appendChild(meta);
  const qt=document.createElement('div');qt.className='question-text';qt.textContent=q.question;card.appendChild(qt);
  const ce=document.createElement('div');ce.className='choices';
  q.choices.forEach(c=>{const btn=document.createElement('button');btn.className='choice-btn';btn.innerHTML=`<div class="choice-letter">${c.letter}</div><div class="choice-text">${escHtml(c.text)}</div>`;btn.addEventListener('click',()=>submitAnswer(c.letter,btn,q,card));ce.appendChild(btn);});
  card.appendChild(ce);
}
function clearAutoAdvance(){if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}}
function submitAnswer(sel,btnEl,q,card){
  clearAutoAdvance();
  const ok=sel===q.answer,autoOn=$('toggle-auto').checked,mastery=$('toggle-mastery').checked;
  card.querySelectorAll('.choice-btn').forEach(b=>{b.disabled=true;if(b.querySelector('.choice-letter').textContent===q.answer)b.classList.add('correct');});
  if(!ok)btnEl.classList.add('wrong');
  if(ok)correctCount++;else{wrongCount++;wrongPool.push(q);if($('toggle-mastery').checked)retryCounts[q.question]=(retryCounts[q.question]||0)+1;}
  sessionResults.push({q,selected:sel,isCorrect:ok});
  $('hdr-c').textContent=correctCount+' ✓';$('hdr-w').textContent=wrongCount+' ✗';
  const fb=document.createElement('div');fb.className='answer-feedback '+(ok?'correct':'wrong');fb.textContent=ok?'✓ Correct':'✗ Incorrect';card.appendChild(fb);
  if(q.explanation&&!autoOn){const rv=document.createElement('div');rv.className='answer-reveal '+(ok?'reveal-correct':'reveal-wrong');rv.innerHTML=`<div class="reveal-body"><span style="font-size:.7rem;font-weight:600;font-family:'Sora',sans-serif;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;">Explanation</span><span class="exp-text"></span></div>`;rv.querySelector('.exp-text').textContent=q.explanation;card.appendChild(rv);}
  if(mastery&&!ok)sessionQuestions.push(shuffleChoices(q));
  const last=currentIdx+1>=sessionQuestions.length;
  const advance=()=>{currentIdx++;last?showSummary():renderQuestion();};
  if(autoOn){
    const bw=document.createElement('div');bw.className='auto-bar-wrap';const bf=document.createElement('div');bf.className='auto-bar-fill';bw.appendChild(bf);card.appendChild(bw);
    const secs=ok?AUTO_ADVANCE_CORRECT_SECS:AUTO_ADVANCE_WRONG_SECS;
    requestAnimationFrame(()=>{bf.style.transition=`width ${secs}s linear`;bf.style.width='0%';});
    autoTimer=setTimeout(advance,secs*1000);
  }else{const nb=document.createElement('button');nb.className='next-btn show';nb.textContent=last?'See Results →':'Next Question →';nb.addEventListener('click',advance);card.appendChild(nb);}
}

function showSummary(){
  showPage('page-summary');
  const mastery=$('toggle-mastery').checked,total=totalUniqueQuestions,attempts=sessionResults.length;
  const ftc=sessionResults.filter((r,i)=>{if(!r.isCorrect)return false;return sessionResults.slice(0,i).filter(x=>x.q.question===r.q.question).length===0;}).length;
  const ftPct=total>0?Math.round((ftc/total)*100):0,retries=attempts-total;
  const pct=mastery?ftPct:(total>0?Math.round((correctCount/total)*100):0);
  const c=2*Math.PI*45,ring=$('score-ring');ring.style.strokeDasharray=c;ring.style.strokeDashoffset=c;
  setTimeout(()=>{ring.style.strokeDashoffset=c-(pct/100)*c;ring.style.stroke=pct>=80?'#4ade80':pct>=60?'#7c6af7':'#f87171';},100);
  $('sum-pct').textContent=pct+'%';$('score-ring-label-text').textContent=mastery?'1st Try':'Score';
  if(mastery){$('sum-title').textContent='🏆 All Mastered!';$('sum-sub').textContent=`${total} questions mastered in ${attempts} attempts`;$('sum-correct').textContent=total;$('label-correct').textContent='Mastered';$('sum-wrong').textContent=retries;$('label-wrong').textContent='Retries';$('sum-total').textContent=ftPct+'%';$('label-total').textContent='Accuracy';}
  else{$('sum-title').textContent=pct===100?'Perfect score!':pct>=80?'Great work!':pct>=60?'Good effort':'Keep practicing';$('sum-sub').textContent=`${correctCount} of ${total} correct`;$('sum-correct').textContent=correctCount;$('label-correct').textContent='Correct';$('sum-wrong').textContent=wrongCount;$('label-wrong').textContent='Incorrect';$('sum-total').textContent=total;$('label-total').textContent='Total';}
  const list=$('review-list');list.innerHTML='';
  const seen=new Set(),uniq=[];
  sessionResults.forEach(r=>{if(!seen.has(r.q.question)){seen.add(r.q.question);uniq.push([...sessionResults].reverse().find(x=>x.q.question===r.q.question));}});
  uniq.forEach((r,i)=>{
      const cc=r.q.choices.find(c=>c.letter===r.q.answer),sc=r.q.choices.find(c=>c.letter===r.selected);
      const ah=r.isCorrect?`<div class="review-ans-block"><div class="review-ans-row"><span class="ca">✓ ${r.q.answer} — ${escHtml(cc?.text||'')}</span></div></div>`:`<div class="review-ans-block"><div class="review-ans-row">Your answer: <span class="wa">${r.selected} — ${escHtml(sc?.text||'')}</span></div><div class="review-ans-row">Correct: <span class="ca">${r.q.answer} — ${escHtml(cc?.text||'')}</span></div></div>`;
      const retries=retryCounts[r.q.question]||0;
      const retryBadge=retries>0?`<span class="retry-badge ${retries>1?'retry-high':''}">${retries} ${retries===1?'retry':'retries'}</span>`:'';
      const item=document.createElement('div');item.className='review-item'+(retries>1?' retried':'');
      item.innerHTML=`<div class="review-dot ${r.isCorrect?'c':'w'}"></div><div style="flex:1;min-width:0;"><div class="review-q" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;"><span style="flex:1;">${i+1}. ${escHtml(r.q.question)}</span>${retryBadge}</div>${ah}</div>`;
      list.appendChild(item);
    });
}

function retakeSession() {
  clearAutoAdvance();
  _beginSession(allBanks.filter(b=>selectedIds.has(b.id)).flatMap(b=>b.questions.map(q=>({...q,_bank:b.name}))));
}
function openQuitModal() {
  $('quit-modal').classList.add('open');
}
function closeQuitModal() {
  $('quit-modal').classList.remove('open');
}
function confirmQuit() {
  clearAutoAdvance();
  closeQuitModal();
  goLanding();
}
function goLanding() {
  showPage('page-landing');
}
function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

let toastTimer;
function showToast(msg,dur=2800,type='') {
  const t=$('toast');
  t.textContent=msg;t.className='toast show'+(type?' '+type:'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.classList.remove('show');},dur);
}
function showErr(msg) {
  const e=$('err-msg');
  e.textContent=msg;e.style.display='block';
  setTimeout(()=>e.style.display='none',4500);
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// ── Drag-to-upload ────────────────────────────────────────────────────────
(function(){
  const panel=$('materials-panel');
  let dragCounter=0;

  function getDropTarget(){
    const isPrivate=vaultMode==='private';
    const folderId=(activeTabId&&activeTabId!=='_all')?activeTabId:'';
    const folders=getCurrentFolders();
    const folder=folderId?folders.find(f=>f.id===folderId):null;
    const label=folder?`📁 ${folder.name}`:(isPrivate?'🔒 Vault root':'📚 Public root');
    return{folderId,label,drive:vaultMode};
  }

  panel.addEventListener('dragenter',e=>{
    if(currentRole!=='admin')return;
    if(!e.dataTransfer.types.includes('Files'))return;
    e.preventDefault();
    dragCounter++;
    const{label}=getDropTarget();
    $('drop-overlay-sub').textContent=`Upload to: ${label}`;
    $('drop-overlay').classList.add('active');
  });

  panel.addEventListener('dragleave',e=>{
    dragCounter--;
    if(dragCounter<=0){dragCounter=0;$('drop-overlay').classList.remove('active');}
  });

  panel.addEventListener('dragover',e=>{
    if(currentRole!=='admin')return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
  });

  panel.addEventListener('drop',e=>{
    e.preventDefault();
    dragCounter=0;
    $('drop-overlay').classList.remove('active');
    if(currentRole!=='admin'){showToast('Upload restricted to admins.',2800,'error');return;}
    const files=e.dataTransfer.files;
    if(!files.length)return;
    handleFiles(files);
  });
})();

function openNewFolderModal(){
  const isPrivate=vaultMode==='private';
  $('new-folder-modal-desc').textContent=`New folder in ${isPrivate?'🔒 Private Vault':'🌐 Public Drive'}.`;
  $('new-folder-input').value='';
  $('new-folder-err').textContent='';
  $('new-folder-modal').classList.add('open');
  setTimeout(()=>$('new-folder-input').focus(),300);
}

async function doCreateFolder(){
  const name=$('new-folder-input').value.trim();
  if(!name){$('new-folder-err').textContent='Please enter a folder name.';return;}
  $('new-folder-confirm').textContent='Creating…';$('new-folder-confirm').disabled=true;
  try{
    const data=await gasPost({action:'createFolder'},{folderName:name,drive:vaultMode,role:currentRole});
    if(data.error){$('new-folder-err').textContent=data.error;return;}
    showToast(`📁 "${name}" created!`,2800,'success');
    $('new-folder-modal').classList.remove('open');
    await loadAllFolders();
    // Auto-switch to the new folder tab
    const newFolder=getCurrentFolders().find(f=>f.id===data.folderId);
    if(newFolder)selectTab(newFolder.id);
  }catch{$('new-folder-err').textContent='Network error. Try again.';}
  finally{$('new-folder-confirm').textContent='Create →';$('new-folder-confirm').disabled=false;}
}

// ── Folder Context Menu ───────────────────────────────────────────────────
let ctxFolderId=null, ctxFolderName=null;

function showCtxMenu(x,y,folderId,folderName){
  ctxFolderId=folderId;ctxFolderName=folderName;
  const menu=$('folder-ctx-menu');
  menu.classList.remove('hidden');
  // Prevent going off-screen
  const mw=160,mh=90;
  const left=x+mw>window.innerWidth?x-mw:x;
  const top=y+mh>window.innerHeight?y-mh:y;
  menu.style.left=left+'px';menu.style.top=top+'px';
}
function hideCtxMenu(){$('folder-ctx-menu').classList.add('hidden');}

function openRenameModal(){
  $('rename-folder-input').value=ctxFolderName;
  $('rename-folder-err').textContent='';
  $('rename-folder-modal').classList.add('open');
  setTimeout(()=>{const inp=$('rename-folder-input');inp.focus();inp.select();},300);
}
function openDeleteFolderModal(){
  $('delete-folder-desc').textContent=`"${ctxFolderName}" and all banks inside will be permanently deleted.`;
  $('delete-folder-modal').classList.add('open');
}

async function doRenameFolder(){
  const name=$('rename-folder-input').value.trim();
  if(!name){$('rename-folder-err').textContent='Please enter a name.';return;}
  if(name===ctxFolderName){$('rename-folder-modal').classList.remove('open');return;}
  $('rename-folder-confirm').textContent='Renaming…';$('rename-folder-confirm').disabled=true;
  try{
    const data=await gasPost({action:'renameFolder'},{folderId:ctxFolderId,folderName:name,role:currentRole});
    if(data.error){$('rename-folder-err').textContent=data.error;return;}
    showToast(`✏️ Renamed to "${name}"`,2800,'success');
    $('rename-folder-modal').classList.remove('open');
    if(activeTabId===ctxFolderId)activeTabId=ctxFolderId;
    await loadAllFolders();
  }catch{$('rename-folder-err').textContent='Network error. Try again.';}
  finally{$('rename-folder-confirm').textContent='Rename →';$('rename-folder-confirm').disabled=false;}
}

async function doDeleteFolder(){
  $('delete-folder-confirm').textContent='Deleting…';$('delete-folder-confirm').disabled=true;
  try{
    const data=await gasPost({action:'deleteFolder'},{folderId:ctxFolderId,role:currentRole});
    if(data.error){showToast(data.error,3000,'error');return;}
    showToast(`🗑️ "${ctxFolderName}" deleted`,2800,'success');
    if(activeTabId===ctxFolderId){activeTabId=null;}
    $('delete-folder-modal').classList.remove('open');
    await loadAllFolders();
    showInitialPane();updateTray();updateStartBtn();
  }catch{showToast('Network error.',3000,'error');}
  finally{$('delete-folder-confirm').textContent='Yes, delete';$('delete-folder-confirm').disabled=false;}
}