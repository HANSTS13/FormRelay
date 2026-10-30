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
    const retryAfter=response.headers?.get?.('retry-after') || undefined;
    let data; try { data = await response.json(); } catch { return {ok:false,status:response.status,retryAfter,error:'Backend returned an unexpected page. Check the URL and that the server is running.'}; }
    return {ok:response.ok,status:response.status,retryAfter,data,error:response.ok ? undefined : data.error || 'Backend request failed'};
  } catch(error) { return {ok:false,status:0,error:'Backend unavailable. Start FormRelay or check its URL, then retry. '+error.message}; }
}
function creationError(response) {
  const advice = response.status===400 && response.error==='Unsupported fields'
    ? 'An older FormRelay backend may still be running. Stop it and run npm start in FormRelay/formrelay/server.'
    : ({400:'Review the selected fields and their supported types.',401:'Enter the correct access key in Settings.',403:'Check the backend access policy and configured origin.',404:'Check the Backend URL in Settings.',429:'Wait for the rate limit to reset before retrying.'}[response.status] || (response.status>=500?'Check the backend terminal for server errors.':''));
  const wait=response.status===429 && /^\d+$/.test(response.retryAfter || '') ? ' Retry after '+response.retryAfter+' seconds.' : '';
  return Object.assign(Error('Request creation failed'+(response.status?' (HTTP '+response.status+')':'')+': '+response.error+(advice?' '+advice:'')+wait),{status:response.status,retryAfter:response.retryAfter});
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
// Migrate the previous single-request session record without dropping its owner token.
const requestsOf = record => record.requests || (record.request ? {[record.request.id]:record.request} : {});
const samePage = (request, url) => request.sourceURL ? request.sourceURL===url : request.sourceOrigin===sourceOrigin(url)&&request.sourcePath===new URL(url).pathname;
function requestView(request, tabId) {
  const view={...publicRequest(request),...request.view,tabId};
  delete view.view;
  if(request.expiresAt<=Date.now()&&!['completed','partial'].includes(view.phase))view.phase='expired';
  return view;
}
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
      const requests=requestsOf(current);
      if (msg.action==='INIT') {
        const matching=Object.values(requests).filter(r=>samePage(r,sender.url||sender.tab.url));
        const request=matching.find(r=>r.id===current.request?.id)||matching.at(-1)||null;
        const changed=current.documentToken!==msg.documentToken;
        await save(id,{...current,requests,documentToken:msg.documentToken,documentId:sender.documentId,view:changed?null:current.view});
        return {ok:true,request,requests:matching,notice:Object.keys(requests).length&&!matching.length?'Original form unavailable. Return to its exact page to confirm mappings.':''};
      }
      if (current.documentToken!==msg.documentToken) return {ok:false,error:'Obsolete document state ignored'};
      const updates=msg.state.requests || (msg.state.request?[msg.state.request]:[]);
      if(updates.some(r=>!requests[r.id]))return {ok:false,error:'Unknown request state ignored'};
      for(const view of updates){const r=requests[view.id];if(!samePage(r,sender.url||sender.tab.url))continue;requests[r.id]={...r,view};}
      await save(id,{...current,requests,view:msg.state}); return {ok:true};
    });
  }
  if (!popupSender) throw Error('This operation is available only from the extension popup');
  if(msg.action==='GET_REQUESTS'){
    const all=await chrome.storage.session.get(null);
    return {ok:true,requests:Object.entries(all).filter(([key])=>key.startsWith(PREFIX)).flatMap(([key,value])=>Object.values(requestsOf(value)).map(r=>requestView(r,Number(key.slice(PREFIX.length)))))};
  }
  const tab=await chrome.tabs.get(msg.tabId);
  if (!tab?.id) throw Error('The original tab is closed. Open a form and start again.');
  if (msg.action==='GET_TAB_STATE') {
    const stored=await record(tab.id);
    const matching=Object.values(requestsOf(stored)).filter(r=>samePage(r,tab.url));
    const sameOrigin=matching.length>0;
    return {ok:true,request:publicRequest(matching.at(-1)),requests:matching.map(publicRequest),view:stored.view?.origin===sourceOrigin(tab.url)?stored.view:null,notice:Object.keys(requestsOf(stored)).length&&!sameOrigin?'Request paused on its original page.':''};
  }
  if (msg.action==='CLEAR_REQUEST') return serial(tab.id,async()=>{
    const current=await record(tab.id);
    // Historical operation name: this now clears only the draft view, never requests.
    await save(tab.id,{...current,requests:requestsOf(current),view:current.view?{...current.view,selection:[],selecting:false}:null}); return {ok:true};
  });
  if (msg.action==='CREATE_REQUEST') return serial(tab.id,async()=>{
    const current=await record(tab.id);
    const base=origin(msg.base);
    const saved=(await chrome.storage.session.get('formrelayAccess')).formrelayAccess;
    if (saved?.key && saved.origin!==base) throw Error('Enter the access key for this backend in Settings.');
    let prepared;
    try {
      prepared=await chrome.tabs.sendMessage(tab.id,{action:'PREPARE_REQUEST'});
      if (!prepared?.ok || !prepared.fields?.length) throw Error(prepared?.error||'Select unanswered fields first.');
      const response=await json(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json',...(saved?.key?{'X-FormRelay-Key':saved.key}:{})},body:JSON.stringify({fields:prepared.fields})});
      if(!response.ok) throw creationError(response);
      const data=response.data;
      if(!/^[a-f0-9]{32}$/.test(data.id)||typeof data.ownerToken!=='string')throw Error('Unexpected request response');
      const request={id:data.id,token:data.ownerToken,base,url:data.url,fields:prepared.contextFields||prepared.fields,createdAt:Date.now(),expiresAt:data.expiresAt||Date.now()+(data.expiresInMinutes||30)*60000,sourceOrigin:sourceOrigin(tab.url),sourcePath:new URL(tab.url).pathname,sourceURL:tab.url,documentToken:prepared.documentToken,phase:'waiting'};
      await save(tab.id,{...current,requests:{...requestsOf(current),[request.id]:request},documentToken:prepared.documentToken,request,view:null});
      const delivered=await chrome.tabs.sendMessage(tab.id,{action:'TRACK',documentToken:prepared.documentToken,track:request}).catch(()=>null);
      return {ok:true,request:publicRequest(request),notice:delivered?.ok?'':'Request saved. Reopen FormRelay on the original site to confirm its mappings.'};
    } catch(error) {
      await chrome.tabs.sendMessage(tab.id,{action:'CREATE_FAILED',error:error.message,status:error.status,retryAfter:error.retryAfter}).catch(()=>{}); throw error;
    }
  });
  throw Error('Unknown extension operation');
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  route(msg,sender).then(reply,error=>reply({ok:false,error:error.message,status:error.status,retryAfter:error.retryAfter}));return true;
});
chrome.storage?.session?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.storage?.local?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function unavailable(id){const current=await record(id),requests=requestsOf(current);if(!Object.keys(requests).length){await chrome.storage.session.remove(bucket(id));return}for(const r of Object.values(requests)){if(!['completed','expired','unauthorized'].includes(r.view?.phase||r.phase))r.view={...(r.view||publicRequest(r)),phase:'unavailable'};}await save(id,{requests,request:current.request,view:null});}
chrome.tabs?.onRemoved?.addListener(id=>{serial(id,()=>unavailable(id)).catch(()=>{})});
chrome.tabs?.onUpdated?.addListener((id,change)=>{if(change.status==='loading')serial(id,()=>unavailable(id)).catch(()=>{})});

const cleanupLegacy=()=>chrome.storage.local.remove(['formrelaySelected','formrelayStatus']).catch(()=>{});
chrome.runtime.onInstalled?.addListener(cleanupLegacy);
chrome.runtime.onStartup?.addListener(cleanupLegacy);
