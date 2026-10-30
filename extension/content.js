(()=>{
if(window.__formrelayLoaded)return;
window.__formrelayLoaded=true;
let selecting=false;let chosen=[];let tracker=null;let timer=null;let previous=new Map();
let scannedFields=[];
const allowed=new Set(['text','tel','email','number','date']);

function getLabelText(el, fallback){
  if(el.labels && el.labels.length > 0){
    const clone = el.labels[0].cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button, .hint').forEach(n => n.remove());
    const text = clone.textContent.trim().replace(/\s+/g, ' ');
    if(text) return text;
  }
  return el.getAttribute('aria-label') || el.placeholder || el.name || el.id || fallback;
}

function fieldOf(el){
  if(el instanceof HTMLSelectElement){
    if(el.disabled||el.closest('[contenteditable="true"]'))return null;
    const name=el.getAttribute('name')||'';
    const id=el.id||'';
    const label=getLabelText(el, name||id||'Unlabeled dropdown');
    if(/password|otp|one.time|verification|cvv|cvc|card|credit|debit|pin|aadhaar|aadhar|ssn/i.test([label,name,id].join(' ')))return null;
    const options=[...el.options].filter(o=>!o.disabled&&o.value.trim()).map(o=>({value:o.value,label:(o.text||o.value).trim()}));
    return {el,label:label.slice(0,100),type:'select',options};
  }
  if(!(el instanceof HTMLInputElement))return null;
  if(!allowed.has(el.type)||el.disabled||el.readOnly||el.closest('[contenteditable="true"]'))return null;
  const name=el.getAttribute('name')||'';
  const id=el.id||'';
  const label=getLabelText(el, el.placeholder||name||id||'Unlabeled field');
  if(/password|otp|one.time|verification|cvv|cvc|card|credit|debit|pin|aadhaar|aadhar|ssn/i.test([label,name,id].join(' ')))return null;
  return {el,label:label.slice(0,100),type:el.type};
}

function selector(el){if(el.id)return '#'+CSS.escape(el.id);const inputs=[...document.querySelectorAll('input,select')];return `input:nth-of-type(${[...el.parentElement.querySelectorAll(':scope > input, :scope > select')].indexOf(el)+1})`}
function findEl(key){return chosen.find(x=>x.key===key)?.el}
function update(){chrome.storage.local.set({formrelaySelected:chosen.map(({key,label,type,options})=>({key,label,type,...(options?{options}:{})}))})}
function hover(e){const f=fieldOf(e.target);if(f)e.target.style.outline='2px dashed #5274fa'}
function unhover(e){const f=fieldOf(e.target);if(f&&!chosen.some(c=>c.el===e.target))e.target.style.outline=''}

function pick(e){
  const f=fieldOf(e.target);
  if(!f)return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const existing=chosen.findIndex(c=>c.el===f.el);
  if(existing>=0){
    chosen.splice(existing,1);
    f.el.style.outline='';
  }else{
    const key=f.el.id ? 'id_'+f.el.id : 'field_'+(chosen.length+1)+'_'+Math.random().toString(36).slice(2,7);
    chosen.push({...f,key});
    f.el.style.outline='3px solid #159260';
  }
  update();
}

function stop(){if(!selecting)return;selecting=false;document.removeEventListener('mouseover',hover,true);document.removeEventListener('mouseout',unhover,true);document.removeEventListener('click',pick,true)}
function start(){stop();selecting=true;chosen=[];update();document.addEventListener('mouseover',hover,true);document.addEventListener('mouseout',unhover,true);document.addEventListener('click',pick,true)}

function scanFields(){
  const elements=[...document.querySelectorAll('input, select')];
  const list=[];
  scannedFields=[];
  for(let i=0;i<elements.length;i++){
    const el=elements[i];
    const f=fieldOf(el);
    if(!f)continue;
    const key=el.id ? 'id_'+el.id : 'field_'+(list.length+1)+'_'+(el.name||el.type||'el');
    const fieldObj={key,el,label:f.label,type:f.type,options:f.options};
    scannedFields.push(fieldObj);
    list.push({key,label:f.label,type:f.type,...(f.options?{options:f.options}:{})});
  }
  return list;
}

function setSelection(keys){
  for(const c of chosen){
    if(c.el&&c.el.isConnected)c.el.style.outline='';
  }
  chosen=[];
  for(const k of keys){
    const item=scannedFields.find(s=>s.key===k);
    if(item&&item.el&&item.el.isConnected){
      chosen.push(item);
      item.el.style.outline='3px solid #159260';
    }
  }
  update();
  return {ok:true,count:chosen.length};
}

function apply(answers){
  if(!tracker||tracker.done)return;
  for(const item of chosen){
    if(!Object.hasOwn(answers,item.key))continue;
    const el=findEl(item.key);
    if(!el||!el.isConnected||!fieldOf(el))continue;
    if(el.value.trim()&&!previous.has(el))continue;
    previous.set(el,el.value);
    const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el,answers[item.key]);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.style.background='#d8f8e6';
    el.title='Filled by FormRelay — review before submitting';
  }
  tracker.done=true;
  clearInterval(timer);
  chrome.storage.local.set({formrelayStatus:'Answers inserted. Review before submitting.'});
}

function poll(){if(!tracker||tracker.done)return;chrome.runtime.sendMessage({action:'FETCH',base:tracker.base,path:`/api/requests/${tracker.id}/status`,token:tracker.token},response=>{if(chrome.runtime.lastError)return;if(response?.ok&&response.data?.submitted)apply(response.data.answers)})}

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg.action==='START'){start();reply({ok:true});}
  else if(msg.action==='STOP'){stop();reply({ok:true});}
  else if(msg.action==='SCAN_FIELDS'){const fields=scanFields();reply({ok:true,fields});}
  else if(msg.action==='SET_SELECTION'){const res=setSelection(msg.keys||[]);reply(res);}
  else if(msg.action==='TRACK'){stop();tracker={...msg.track,done:false};if(timer)clearInterval(timer);poll();timer=setInterval(poll,2500);reply({ok:true});}
  else if(msg.action==='UNDO'){
    for(const [el,value] of previous){
      if(!el.isConnected)continue;
      const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.style.background='';
      el.title='';
    }
    previous.clear();
    reply({ok:true});
  }
});
})();
