const $ = id => document.getElementById(id);
let tabId = null, state = null, busy = false, epoch = 0, refreshTimer = null;
let history = [], viewRequestId = null, viewTabId = null;
const labels={waiting:'Pending',received:'Response Received',completed:'Autofilled',partial:'Partially Failed',expired:'Expired',unavailable:'Original Form Unavailable',unauthorized:'Access denied',offline:'Pending - reconnecting'};
const viewedRequest=()=>history.find(r=>r.id===viewRequestId)||state?.request;
function backendOrigin(value) {
  const url = new URL(value);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!((url.protocol==='http:'&&url.hostname==='localhost')||(url.protocol==='https:'&&url.hostname.endsWith('.onrender.com')&&!url.port)))throw Error('Use a localhost backend or an HTTPS onrender.com origin, with no path.');
  return url.origin;
}
function notify(text, kind='success') { $('message').textContent=text; $('message').className='notice '+kind; $('message').hidden=!text; }
function section(name) {
  document.querySelectorAll('[data-tab]').forEach(button=>{const selected=button.dataset.tab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('panel-'+button.dataset.tab).hidden=!selected});
}
async function worker(action, extra={}) {
  const result = await chrome.runtime.sendMessage({action,tabId,...extra});
  if(result?.ok===false)throw Error(result.error||'Operation failed. Reopen FormRelay and retry.');
  return result;
}
async function content(action,extra={}) {
  if(!tabId)throw Error('Open an ordinary web form tab first.');
  const response = await chrome.tabs.sendMessage(tabId,{action,...extra});
  if(response?.ok===false)throw Error(response.error);
  return response;
}
async function ensure() {
  try { const ping=await content('PING');if(ping?.version==='0.4.0')return; } catch {}
  try {
    await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
    const ping=await content('PING');if(ping?.version!=='0.4.0')throw Error('Refresh this webpage once after updating the extension source.');
  }catch(error){throw Error('Cannot connect to this page. Open a normal website, activate FormRelay from its toolbar icon, and retry. After editing extension source, refresh the page. '+error.message)}
}
async function saveSettings() {
  const origin=backendOrigin($('base').value),key=$('accessKey').value.trim();
  const saved=(await chrome.storage.session.get('formrelayAccess')).formrelayAccess;
  if(saved?.key&&saved.origin!==origin&&saved.key===key)throw Error('Backend changed. Clear the old key and enter the key for this backend.');
  await chrome.storage.local.set({formrelayBase:origin});await chrome.storage.session.set({formrelayAccess:{origin,key}});$('base').value=origin;return origin;
}
async function refresh() {
  const mine=++epoch;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('Open a form on an ordinary HTTP or HTTPS website first. Browser settings pages are not supported.');
    if(viewTabId!==tab.id){viewRequestId=null;viewTabId=tab.id}
    tabId=tab.id;$('website').textContent=new URL(tab.url).hostname;
    await ensure();const snapshot=await content('GET_STATE');if(mine!==epoch)return;
    const saved=await worker('GET_REQUESTS');if(mine!==epoch)return;
    state=snapshot;history=saved.requests||snapshot.requests||(snapshot.request?[snapshot.request]:[]);
    history=history.map(r=>{const live=snapshot.requests?.find(item=>item.id===r.id);return live?{...r,...live,tabId:tab.id}:r});
    if(!viewRequestId||!history.some(r=>r.id===viewRequestId))viewRequestId=snapshot.request?.id||history.at(-1)?.id||null;
    render();$('connection').textContent='Connected to this page';$('connection-dot').className='dot online';
    if(state.status)notify(state.status,/failed|denied|unavailable|expired|interrupted/i.test(state.status)?'error':'success');
  }catch(error){if(mine!==epoch)return;state=null;render();$('connection').textContent='Page connection needs attention';$('connection-dot').className='dot offline';notify(error.message,'error')}
}
function row(field, removable) {
  const li=document.createElement('li');li.className='field-row';
  const icon=document.createElement('span');icon.className='field-type';icon.textContent=field.type==='checkbox-group'?'[]':field.type==='checkbox'?'[]':field.type==='radio'?'O':field.type==='select'?'v':'Aa';icon.setAttribute('aria-hidden','true');
  const text=document.createElement('div');text.className='field-label';const label=document.createElement('strong');label.textContent=field.label;const type=document.createElement('small');type.textContent=field.type;text.append(label,type);li.append(icon,text);
  if(removable){const remove=document.createElement('button');remove.className='remove-field';remove.textContent='x';remove.setAttribute('aria-label','Remove '+field.label);remove.disabled=busy||state?.creating;remove.onclick=()=>operate('Removing field',()=>content('REMOVE_FIELD',{key:field.key}));li.appendChild(remove)}return li;
}
function results(container,items,processing=false,requestId=null) {
  container.replaceChildren();
  for(const item of items){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=item.label+': ';p.append(strong,document.createTextNode(item.state+' - '+(item.detail||'')));container.appendChild(p);
    if(item.needsConfirmation){const button=document.createElement('button');button.className='button secondary';button.textContent='Confirm replacement for '+item.label;button.disabled=processing||busy;button.onclick=()=>operate('Preparing mapping confirmation',async()=>{await content('CONFIRM_MAPPING',{key:item.key,requestId});notify('Close this popup and click the matching unanswered replacement for '+item.label)});container.appendChild(button)}
    if(item.needsOverwrite){const button=document.createElement('button');button.className='button secondary';button.textContent='Replace existing answer for '+item.label;button.disabled=processing||busy;button.onclick=()=>{if(window.confirm('Replace the existing answer for '+item.label+' with this request’s response?'))operate('Replacing confirmed answer',()=>content('CONFIRM_OVERWRITE',{key:item.key,requestId:requestId||state?.request?.id}))};container.appendChild(button)}
  }
}
function render() {
  const selected=state?.selection||[],request=viewedRequest(),locked=state?.creating||state?.busy||busy;
  $('tab-count').textContent=selected.length;$('selection-count').textContent=selected.length+' selected';$('empty-fields').hidden=selected.length>0||!!request;
  $('fields').replaceChildren(...selected.map(f=>row(f,true)));$('select').disabled=!state||locked;$('finish').disabled=!state?.selecting||busy;
  $('clear').disabled=!selected.length||locked;$('create').disabled=!selected.length||locked;$('check').disabled=!state||busy;
  $('selection-hint').textContent=state?.selecting?'Selection mode is on':'Earlier requests keep their own mappings';
  $('new-fields').hidden=!history.length;$('new-fields').disabled=busy||state?.creating;
  $('request-picker').replaceChildren(...history.map(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.id.slice(0,8)+' - '+(labels[r.phase]||r.phase||'Pending')+' - '+(r.sourceOrigin||'this page')+(r.tabId&&r.tabId!==tabId?' (another tab)':'');return option}));$('request-picker').value=viewRequestId||'';$('request-picker').disabled=busy||!history.length;
  $('empty-request').hidden=!!request;$('request-card').hidden=!request;$('request-dot').hidden=!request;
  if(!request)return;
  $('request-origin').textContent='Original page: '+(request.sourcePath||'this document')+'. Replaced controls require confirmation.';
  $('request-status').textContent=labels[request.phase]||request.phase;$('request-title').textContent=labels[request.phase]||'Request ready';
  $('request-description').textContent=request.phase==='completed'?'Values were checked after page events. Review them before submitting.':request.phase==='partial'?'Some questions need attention. Your original page is never submitted by FormRelay.':request.phase==='offline'?'The server is unavailable. FormRelay retries while the original tab stays open.':'Share this link or QR with your collaborator.';
  const qr=request.base+'/api/requests/'+request.id+'/qr.png';if($('qr').getAttribute('src')!==qr)$('qr').src=qr;
  $('qr').hidden=['expired','unauthorized'].includes(request.phase);$('link').value=request.url||'';$('copy').disabled=busy||['expired','unauthorized'].includes(request.phase);
  $('requested-fields').replaceChildren(...request.fields.map(f=>{const li=document.createElement('li');li.textContent=f.label;return li}));
  const local=(!request.tabId||request.tabId===tabId)&&state?.requests?.some(r=>r.id===request.id);
  results($('results'),request.results||[],state?.busy||!local,request.id);$('undo').disabled=busy||state?.busy||!local||!(request.results||[]).some(f=>f.state==='verified');
  if(request.phase==='unavailable')$('request-description').textContent='The original tab is closed or on another page. Answers will never be inserted here. If the tab still exists, return to its exact original URL and confirm mappings.';
  $('new-request').disabled=busy||!state||state.creating;expiry();
}
function expiry() { const request=viewedRequest(),value=request?.expiresAt;if(!value){$('expiry').textContent='Link expires about 30 minutes after creation.';return}if(value<=Date.now()&&!['completed','partial','expired'].includes(request.phase)){request.phase='expired';render();return}const left=Math.max(0,Math.ceil((value-Date.now())/60000));$('expiry').textContent=left?'Expires in about '+left+' minute'+(left===1?'':'s')+'.':'This link has expired. Create a new request.'; }
async function operate(label,action,tabAfter=null) {
  if(busy)return;busy=true;render();notify(label+'...','loading');
  try{await action();if(tabAfter)section(tabAfter);await refresh()}catch(error){notify(error.message,'error')}finally{busy=false;render()}
}
async function newRequest() {
  await content('NEW_REQUEST');await worker('CLEAR_REQUEST');$('compatibility').replaceChildren();section('fields');
}
$('select').onclick=()=>operate('Starting selection',()=>content('START'));
$('finish').onclick=()=>operate('Finishing selection',()=>content('STOP'));
$('clear').onclick=()=>operate('Clearing selection',()=>content('CLEAR'));
$('create').onclick=()=>operate('Generating request and QR',async()=>{const base=await saveSettings();const result=await worker('CREATE_REQUEST',{base});viewRequestId=result.request.id},'requests');
$('new-request').onclick=$('new-fields').onclick=()=>operate('Starting a new request',newRequest);
$('undo').onclick=()=>operate('Restoring inserted values',()=>content('UNDO',{requestId:viewedRequest()?.id}));
$('request-picker').onchange=()=>{const id=$('request-picker').value;return operate('Opening saved request',async()=>{viewRequestId=id;if(state?.requests?.some(r=>r.id===id))await content('SELECT_REQUEST',{requestId:id})})};
$('refresh').onclick=()=>refresh();$('go-fields').onclick=()=>section('fields');
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(viewedRequest().url);notify('Request link copied. Share only this link.')}catch{$('link').focus();$('link').select();notify('Select the link and press Ctrl+C to copy.','error')}};
$('qr').onerror=()=>{if(state?.request&&!['expired','unauthorized'].includes(state.request.phase))notify('QR image unavailable. Check the backend in Settings; the request link may still work.','error')};
$('test-connection').onclick=()=>operate('Testing backend connection',async()=>{const base=await saveSettings();await worker('TEST_CONNECTION',{base});$('settings-status').textContent='Backend connected successfully. The access key is checked when creating a request.'});
$('check').onclick=()=>operate('Checking compatibility',async()=>{
  const report=await content('CHECK'),container=$('compatibility');container.replaceChildren();
  const summary=document.createElement('p');summary.textContent=report.fields.filter(f=>f.supported).length+' supported unanswered fields; '+report.fields.filter(f=>!f.supported).length+' unavailable. '+report.limitations;container.appendChild(summary);
  if(report.duplicates){const warning=document.createElement('p');warning.textContent='Repeated labels detected. Exact clicked elements stay separate; replaced elements need confirmation.';container.appendChild(warning)}
  results(container.appendChild(document.createElement('div')),report.selected,report.busy);
  const details=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Show field compatibility';details.appendChild(heading);
  for(const f of report.fields){const p=document.createElement('p');p.textContent=f.label+' ['+f.type+']: '+(f.supported?'Supported':f.reason)+' - '+f.location;details.appendChild(p)}
  if(report.frames||report.custom||report.truncated){const p=document.createElement('p');p.textContent=report.frames+' frames and '+report.custom+' custom widgets detected. '+(report.truncated?'Scan limited to 1000 controls.':'Use only fields reported as supported.');details.appendChild(p)}container.appendChild(details);
});
document.querySelectorAll('[data-tab]').forEach(button=>{button.onclick=()=>section(button.dataset.tab);button.onkeydown=event=>{const buttons=[...document.querySelectorAll('[data-tab]')];let index=buttons.indexOf(button);if(event.key==='ArrowRight')index=(index+1)%buttons.length;else if(event.key==='ArrowLeft')index=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=buttons.length-1;else return;event.preventDefault();section(buttons[index].dataset.tab);buttons[index].focus()}});
chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='session'&&Object.keys(changes).some(key=>key.startsWith('formrelay.tab.'))){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(!busy)refresh()},120)}});
chrome.tabs.onActivated?.addListener(()=>refresh());
chrome.tabs.onUpdated?.addListener((id,change)=>{if(id===tabId&&change.status==='complete')refresh()});
(async()=>{const saved=await chrome.storage.local.get('formrelayBase');$('base').value=saved.formrelayBase||'http://localhost:3000';const access=(await chrome.storage.session.get('formrelayAccess')).formrelayAccess;if(access?.origin===$('base').value)$('accessKey').value=access.key;await refresh()})().catch(error=>notify(error.message,'error'));
setInterval(expiry,1000);

// =============================================================
// AI Smart Field Grouping Feature
// =============================================================
let scannedFields = [];
let aiGroups = [];

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const aiBtn = $('btn-ai-group');
if (aiBtn) {
  aiBtn.onclick = async () => {
    try {
      notify('Scanning webpage fields for AI segregation...', 'loading');
      await ensure();
      const res = await content('SCAN_FIELDS');
      if (!res?.ok || !res.fields?.length) {
        throw new Error('No supported form questions found on this page. Navigate to your form first.');
      }
      scannedFields = res.fields;
      $('ai-scan-summary').textContent = 'Found ' + scannedFields.length + ' questions on this form.';
      $('ai-panel').style.display = 'block';
      $('ai-approval').style.display = 'block';
      $('ai-loading').style.display = 'none';
      $('ai-results').style.display = 'none';
      notify('');
    } catch (err) {
      notify(err.message, 'error');
    }
  };
}

if ($('ai-close')) $('ai-close').onclick = () => { $('ai-panel').style.display = 'none'; };
if ($('ai-cancel')) $('ai-cancel').onclick = () => { $('ai-panel').style.display = 'none'; };
if ($('btn-skip-ai')) $('btn-skip-ai').onclick = () => {
  $('ai-panel').style.display = 'none';
  notify('Manual selection enabled. Click "+ Start selection".');
};

if ($('ai-confirm')) {
  $('ai-confirm').onclick = async () => {
    $('ai-approval').style.display = 'none';
    $('ai-loading').style.display = 'block';
    $('ai-results').style.display = 'none';

    try {
      const origin = backendOrigin($('base').value);
      const resp = await fetch(origin + '/api/ai/group-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: scannedFields })
      });
      const data = await resp.json().catch(() => ({ ok: false, error: 'Invalid response from server' }));
      $('ai-loading').style.display = 'none';

      if (!data.ok) {
        $('ai-approval').style.display = 'block';
        notify('AI Error: ' + data.error, 'error');
        return;
      }

      aiGroups = data.groups || [];
      if (!aiGroups.length) {
        $('ai-approval').style.display = 'block';
        notify('AI found no separable groups.', 'error');
        return;
      }

      renderAiGroupCards(aiGroups, origin);
      $('ai-results').style.display = 'block';
      notify('AI segregated ' + aiGroups.length + ' group(s). Create QR/link for each member below.');
    } catch (err) {
      $('ai-loading').style.display = 'none';
      $('ai-approval').style.display = 'block';
      notify('Network error: ' + err.message, 'error');
    }
  };
}

function renderAiGroupCards(groups, origin) {
  const container = $('group-cards-container');
  container.replaceChildren();

  // Top action: generate for all groups at once
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'button primary wide';
  allBtn.style.cssText = 'background: #0d6b61; margin-bottom: 12px; font-weight: 700; font-size: 11px; min-height: 34px;';
  allBtn.textContent = '⚡ Generate QRs for All Groups (' + groups.length + ')';
  allBtn.onclick = async () => {
    allBtn.disabled = true;
    allBtn.textContent = 'Generating all QRs...';
    for (let i = 0; i < groups.length; i++) {
      await createQrForGroupCard(groups[i], i, origin);
    }
    allBtn.textContent = '✓ All QRs Generated!';
  };
  container.appendChild(allBtn);

  groups.forEach((g, idx) => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';
    header.innerHTML = '<strong style="font-size: 13px; color: #1e1b4b;">👥 ' + escapeHtml(g.groupName) + '</strong><span style="font-size: 10px; background: #e0e7ff; color: #3730a3; padding: 2px 7px; border-radius: 10px; font-weight: 600;">' + (g.fields || []).length + ' questions</span>';

    const desc = document.createElement('div');
    desc.style.cssText = 'color: #64748b; font-size: 10px; margin-bottom: 8px;';
    desc.textContent = g.description || '';

    const list = document.createElement('div');
    list.style.cssText = 'padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 10px; font-size: 11px;';
    (g.fields || []).forEach(f => {
      const item = document.createElement('div');
      item.style.cssText = 'padding: 2px 0; color: #334155; display: flex; justify-content: space-between; align-items: center;';
      item.innerHTML = '<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;">• ' + escapeHtml(f.label) + '</span><small style="color: #64748b; margin-left: 6px;">' + escapeHtml(f.type || 'text') + '</small>';
      list.appendChild(item);
    });

    const createBtn = document.createElement('button');
    createBtn.id = 'ai-create-btn-' + idx;
    createBtn.type = 'button';
    createBtn.className = 'button primary wide';
    createBtn.style.cssText = 'background: #4f46e5; font-size: 11px; min-height: 32px; font-weight: 600;';
    createBtn.textContent = 'Generate QR / Link for ' + g.groupName;
    createBtn.onclick = () => createQrForGroupCard(g, idx, origin);

    // Result frame for this specific group's QR & link
    const resultBox = document.createElement('div');
    resultBox.id = 'ai-result-box-' + idx;
    resultBox.style.cssText = 'display: none; margin-top: 10px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px; background: #fdfdfd; border-radius: 6px;';
    resultBox.innerHTML = `
      <div style="font-weight: 700; color: #0d6b61; font-size: 11px; margin-bottom: 6px;">QR for ${escapeHtml(g.groupName)}</div>
      <img id="ai-qr-img-${idx}" style="width: 130px; height: 130px; border-radius: 6px; border: 1px solid #cbd5e1; padding: 4px; display: block; margin: 0 auto 8px auto; background: white;">
      <a id="ai-link-${idx}" target="_blank" style="font-size: 10px; color: #2563eb; word-break: break-all; display: block; margin-bottom: 6px; text-decoration: underline;"></a>
      <button id="ai-copy-btn-${idx}" type="button" class="button secondary wide" style="min-height: 28px; font-size: 10px;">📋 Copy Link for ${escapeHtml(g.groupName)}</button>
      <div style="font-size: 10px; color: #059669; font-weight: 600; margin-top: 6px;">✓ Separate link ready to send!</div>
    `;

    card.append(header, desc, list, createBtn, resultBox);
    container.appendChild(card);
  });
}

async function createQrForGroupCard(g, idx, origin) {
  const btn = document.getElementById('ai-create-btn-' + idx);
  const resultBox = document.getElementById('ai-result-box-' + idx);
  const qrImg = document.getElementById('ai-qr-img-' + idx);
  const linkEl = document.getElementById('ai-link-' + idx);
  const copyBtn = document.getElementById('ai-copy-btn-' + idx);

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating QR...';
  }

  try {
    const keys = (g.fields || []).map(f => f.key);
    await content('SET_SELECTION', { keys });

    const base = await saveSettings();
    const result = await worker('CREATE_REQUEST', { base });
    const req = result.request;

    if (btn) {
      btn.textContent = '✓ ' + g.groupName + ' Link Created';
      btn.style.background = '#059669';
      btn.disabled = false;
    }

    if (resultBox && qrImg && linkEl) {
      qrImg.src = base + '/api/requests/' + req.id + '/qr.png';
      linkEl.href = req.url;
      linkEl.textContent = req.url;
      if (copyBtn) {
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(req.url);
          notify('Copied link for ' + g.groupName + '!');
        };
      }
      resultBox.style.display = 'block';
    }

    notify('Created delegation link for ' + g.groupName + '!');
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Generate QR / Link for ' + g.groupName;
    }
    notify('Error: ' + err.message, 'error');
  }
}
