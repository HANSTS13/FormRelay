const $ = id => document.getElementById(id);
let tabId = null, state = null, busy = false, epoch = 0, refreshTimer = null;
const terminal = new Set(['completed','partial','expired','unauthorized']);
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
    tabId=tab.id;$('website').textContent=new URL(tab.url).hostname;
    await ensure();const snapshot=await content('GET_STATE');if(mine!==epoch)return;
    state=snapshot;render();$('connection').textContent='Connected to this page';$('connection-dot').className='dot online';
    if(state.status)notify(state.status,/failed|denied|unavailable|expired|interrupted/i.test(state.status)?'error':'success');
  }catch(error){if(mine!==epoch)return;state=null;render();$('connection').textContent='Page connection needs attention';$('connection-dot').className='dot offline';notify(error.message,'error')}
}
function row(field, removable) {
  const li=document.createElement('li');li.className='field-row';
  const icon=document.createElement('span');icon.className='field-type';icon.textContent=field.type==='checkbox-group'?'[]':field.type==='checkbox'?'[]':field.type==='radio'?'O':field.type==='select'?'v':'Aa';icon.setAttribute('aria-hidden','true');
  const text=document.createElement('div');text.className='field-label';const label=document.createElement('strong');label.textContent=field.label;const type=document.createElement('small');type.textContent=field.type;text.append(label,type);li.append(icon,text);
  if(removable){const remove=document.createElement('button');remove.className='remove-field';remove.textContent='x';remove.setAttribute('aria-label','Remove '+field.label);remove.disabled=busy||state?.creating;remove.onclick=()=>operate('Removing field',()=>content('REMOVE_FIELD',{key:field.key}));li.appendChild(remove)}return li;
}
function results(container,items,processing=false) {
  container.replaceChildren();
  for(const item of items){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=item.label+': ';p.append(strong,document.createTextNode(item.state+' - '+(item.detail||'')));container.appendChild(p);
    if(item.needsConfirmation){const button=document.createElement('button');button.className='button secondary';button.textContent='Confirm replacement for '+item.label;button.disabled=processing||busy;button.onclick=()=>operate('Preparing mapping confirmation',async()=>{await content('CONFIRM_MAPPING',{key:item.key});notify('Close this popup and click the matching unanswered replacement for '+item.label)});container.appendChild(button)}
  }
}
function render() {
  const selected=state?.selection||[],request=state?.request,locked=!!request||state?.creating||state?.busy||busy;
  $('tab-count').textContent=selected.length;$('selection-count').textContent=selected.length+' selected';$('empty-fields').hidden=selected.length>0||!!request;
  $('fields').replaceChildren(...selected.map(f=>row(f,true)));$('select').disabled=!state||locked;$('finish').disabled=!state?.selecting||busy;
  $('clear').disabled=!selected.length||locked;$('create').disabled=!selected.length||locked;$('check').disabled=!state||busy;
  $('selection-hint').textContent=state?.selecting?'Selection mode is on':request?'Mappings are held with your request':'Up to 20 questions';
  $('new-fields').hidden=!request;$('new-fields').disabled=busy||!!request&&!terminal.has(request.phase);
  $('empty-request').hidden=!!request;$('request-card').hidden=!request;$('request-dot').hidden=!request;
  if(!request)return;
  const labels={waiting:'Waiting for response',received:'Response received',completed:'Autofill completed',partial:'Review required',expired:'Request expired',unauthorized:'Access denied',offline:'Reconnecting'};
  $('request-origin').textContent='Original page: '+(request.sourcePath||'this document')+'. Replaced controls require confirmation.';
  $('request-status').textContent=labels[request.phase]||request.phase;$('request-title').textContent=labels[request.phase]||'Request ready';
  $('request-description').textContent=request.phase==='completed'?'Values were checked after page events. Review them before submitting.':request.phase==='partial'?'Some questions need attention. Your original page is never submitted by FormRelay.':request.phase==='offline'?'The server is unavailable. FormRelay retries while the original tab stays open.':'Share this link or QR with your collaborator.';
  const qr=request.base+'/api/requests/'+request.id+'/qr.png';if($('qr').getAttribute('src')!==qr)$('qr').src=qr;
  $('qr').hidden=['expired','unauthorized'].includes(request.phase);$('link').value=request.url||'';$('copy').disabled=busy||['expired','unauthorized'].includes(request.phase);
  $('requested-fields').replaceChildren(...request.fields.map(f=>{const li=document.createElement('li');li.textContent=f.label;return li}));
  results($('results'),request.results||[],state.busy);$('undo').disabled=busy||state.busy||!(request.results||[]).some(f=>f.state==='verified');
  $('new-request').disabled=busy||state.busy||!terminal.has(request.phase);expiry();
}
function expiry() { const value=state?.request?.expiresAt;if(!value){$('expiry').textContent='Link expires about 30 minutes after creation.';return}const left=Math.max(0,Math.ceil((value-Date.now())/60000));$('expiry').textContent=left?'Expires in about '+left+' minute'+(left===1?'':'s')+'.':'This link has expired. Create a new request.'; }
async function operate(label,action,tabAfter=null) {
  if(busy)return;busy=true;render();notify(label+'...','loading');
  try{await action();if(tabAfter)section(tabAfter);await refresh()}catch(error){notify(error.message,'error')}finally{busy=false;render()}
}
async function newRequest() {
  if(state?.request?.phase==='partial'&&!window.confirm('Start a new request? Pending mapping corrections will be discarded. This does not revoke the old recipient link.'))return;
  await worker('CLEAR_REQUEST');await content('NEW_REQUEST');$('compatibility').replaceChildren();section('fields');
}
$('select').onclick=()=>operate('Starting selection',()=>content('START'));
$('finish').onclick=()=>operate('Finishing selection',()=>content('STOP'));
$('clear').onclick=()=>operate('Clearing selection',()=>content('CLEAR'));
$('create').onclick=()=>operate('Generating request and QR',async()=>{const base=await saveSettings();await worker('CREATE_REQUEST',{base})},'requests');
$('new-request').onclick=$('new-fields').onclick=()=>operate('Starting a new request',newRequest);
$('undo').onclick=()=>operate('Restoring inserted values',()=>content('UNDO'));
$('refresh').onclick=()=>refresh();$('go-fields').onclick=()=>section('fields');
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.request.url);notify('Request link copied. Share only this link.')}catch{$('link').focus();$('link').select();notify('Select the link and press Ctrl+C to copy.','error')}};
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
chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='session'&&changes['formrelay.tab.'+tabId]){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(!busy)refresh()},120)}});
chrome.tabs.onActivated?.addListener(()=>refresh());
chrome.tabs.onUpdated?.addListener((id,change)=>{if(id===tabId&&change.status==='complete')refresh()});
(async()=>{const saved=await chrome.storage.local.get('formrelayBase');$('base').value=saved.formrelayBase||'http://localhost:3000';const access=(await chrome.storage.session.get('formrelayAccess')).formrelayAccess;if(access?.origin===$('base').value)$('accessKey').value=access.key;await refresh()})().catch(error=>notify(error.message,'error'));
setInterval(expiry,1000);
