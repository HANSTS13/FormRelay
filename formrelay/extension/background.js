// The worker owns request creation and tab-scoped session records, not DOM mappings.
const PREFIX = 'formrelay.tab.';
const queues = new Map();
function origin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !((url.protocol === 'http:' && url.hostname === 'localhost') || (url.protocol === 'https:' && url.hostname.endsWith('.onrender.com') && !url.port))) throw Error('Use http://localhost:3000 or an HTTPS onrender.com origin.');
  return url.origin;
}
async function json(url, options = {}) {
  try {
    const response = await fetch(url, {...options, credentials:'omit', redirect:'error', ...(typeof AbortSignal !== 'undefined' ? {signal:AbortSignal.timeout(8000)} : {})});
    let data; try { data = await response.json(); } catch { throw Error('Backend returned an unexpected page. Check the URL and that the server is running.'); }
    return {ok:response.ok,status:response.status,data,error:response.ok ? undefined : data.error || 'Backend request failed'};
  } catch(error) { return {ok:false,status:0,error:'Backend unavailable. Start FormRelay or check its URL, then retry. '+error.message}; }
}
const bucket = id => PREFIX + id;
async function record(id) { return (await chrome.storage.session.get(bucket(id)))[bucket(id)] || {}; }
async function save(id, value) { await chrome.storage.session.set({[bucket(id)]:value}); }
function serial(id, action) {
  const next = (queues.get(id) || Promise.resolve()).catch(()=>{}).then(action);
  queues.set(id,next); return next.finally(()=>{if(queues.get(id)===next)queues.delete(id)});
}
const sourceOrigin = value => { try { return new URL(value).origin; } catch { return ''; } };
const publicRequest = request => request ? Object.fromEntries(Object.entries(request).filter(([key])=>key!=='token')) : null;
async function route(msg, sender) {
  const popupSender=!sender.tab||sender.url==='chrome-extension://'+chrome.runtime.id+'/popup.html';
  if (msg.action === 'FETCH') {
    const base=origin(msg.base);
    if (!/^\/api\/requests\/[a-f0-9]{32}\/status$/.test(msg.path)) throw Error('Invalid API path');
    return json(base+msg.path,{headers:{Authorization:'Bearer '+msg.token}});
  }
  if (msg.action === 'TEST_CONNECTION') {
    if (!popupSender) throw Error('Only the extension settings can test a backend');
    const response=await json(origin(msg.base)+'/health');
    return response.ok && response.data?.ok===true ? response : {...response,ok:false,error:response.error || 'The URL is not a healthy FormRelay server.'};
  }
  if (msg.action === 'INIT' || msg.action === 'STATE_UPDATE') {
    if (!sender.tab?.id || !sender.documentId && !msg.documentToken) throw Error('Missing document context');
    const id=sender.tab.id;
    return serial(id,async()=>{
      const current=await record(id);
      if (msg.action==='INIT') {
        const sameOrigin=current.request?.sourceOrigin===sourceOrigin(sender.url||sender.tab.url);
        const request=sameOrigin ? current.request : null;
        const changed=current.documentToken!==msg.documentToken;
        await save(id,{...current,documentToken:msg.documentToken,documentId:sender.documentId,view:changed?null:current.view});
        return {ok:true,request,notice:current.request&&!sameOrigin?'A request from another website is paused in this tab.':''};
      }
      if (current.documentToken!==msg.documentToken) return {ok:false,error:'Obsolete document state ignored'};
      // Ignore stale updates after a new request replaced an older one.
      if (msg.state.request && current.request && msg.state.request.id!==current.request.id) return {ok:false,error:'Obsolete request state ignored'};
      await save(id,{...current,view:msg.state}); return {ok:true};
    });
  }
  if (!popupSender) throw Error('This operation is available only from the extension popup');
  const tab=await chrome.tabs.get(msg.tabId);
  if (!tab?.id) throw Error('The original tab is closed. Open a form and start again.');
  if (msg.action==='GET_TAB_STATE') {
    const stored=await record(tab.id);
    const sameOrigin=stored.request?.sourceOrigin===sourceOrigin(tab.url);
    return {ok:true,request:sameOrigin?publicRequest(stored.request):null,view:stored.view?.origin===sourceOrigin(tab.url)?stored.view:null,notice:stored.request&&!sameOrigin?'Request paused on its original website.':''};
  }
  if (msg.action==='CLEAR_REQUEST') return serial(tab.id,async()=>{
    const current=await record(tab.id);
    const phase=current.view?.request?.phase;
    if (current.request && current.request.expiresAt>Date.now() && !['completed','partial','expired','unauthorized'].includes(phase)) throw Error('A request is still active. Wait for its response or expiry before starting a new one.');
    await save(tab.id,{documentToken:current.documentToken,documentId:current.documentId,view:null}); return {ok:true};
  });
  if (msg.action==='CREATE_REQUEST') return serial(tab.id,async()=>{
    const current=await record(tab.id);
    const phase=current.view?.request?.phase;
    if (current.request && current.request.expiresAt>Date.now() && !['completed','expired','unauthorized'].includes(phase)) throw Error('A request is already active in this tab. Resolve it or wait for expiry.');
    const base=origin(msg.base);
    const saved=(await chrome.storage.session.get('formrelayAccess')).formrelayAccess;
    if (saved?.key && saved.origin!==base) throw Error('Enter the access key for this backend in Settings.');
    let prepared;
    try {
      prepared=await chrome.tabs.sendMessage(tab.id,{action:'PREPARE_REQUEST'});
      if (!prepared?.ok || !prepared.fields?.length) throw Error(prepared?.error||'Select unanswered fields first.');
      const response=await json(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json',...(saved?.key?{'X-FormRelay-Key':saved.key}:{})},body:JSON.stringify({fields:prepared.fields})});
      if(!response.ok) throw Error(response.error);
      const data=response.data;
      if(!/^[a-f0-9]{32}$/.test(data.id)||typeof data.ownerToken!=='string')throw Error('Unexpected request response');
      const request={id:data.id,token:data.ownerToken,base,url:data.url,fields:prepared.contextFields||prepared.fields,expiresAt:data.expiresAt||Date.now()+(data.expiresInMinutes||30)*60000,sourceOrigin:sourceOrigin(tab.url),sourcePath:new URL(tab.url).pathname,documentToken:prepared.documentToken};
      await save(tab.id,{...current,documentToken:prepared.documentToken,request,view:null});
      const delivered=await chrome.tabs.sendMessage(tab.id,{action:'TRACK',documentToken:prepared.documentToken,track:request}).catch(()=>null);
      return {ok:true,request:publicRequest(request),notice:delivered?.ok?'':'Request saved. Reopen FormRelay on the original site to confirm its mappings.'};
    } catch(error) {
      await chrome.tabs.sendMessage(tab.id,{action:'CREATE_FAILED'}).catch(()=>{}); throw error;
    }
  });
  throw Error('Unknown extension operation');
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  route(msg,sender).then(reply,error=>reply({ok:false,error:error.message}));return true;
});
chrome.storage?.session?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.storage?.local?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.tabs?.onRemoved?.addListener(id=>{serial(id,()=>chrome.storage.session.remove(bucket(id))).catch(()=>{})});
chrome.tabs?.onUpdated?.addListener((id,change)=>{if(change.status==='loading')serial(id,async()=>{const current=await record(id);if(current.request)await save(id,{request:current.request});else await chrome.storage.session.remove(bucket(id))}).catch(()=>{})});

const cleanupLegacy=()=>chrome.storage.local.remove(['formrelaySelected','formrelayStatus']).catch(()=>{});
chrome.runtime.onInstalled?.addListener(cleanupLegacy);
chrome.runtime.onStartup?.addListener(cleanupLegacy);
