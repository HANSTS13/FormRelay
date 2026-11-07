(() => {
  const VERSION = '0.4.0';
  if (window.__formrelayInstance?.version === VERSION && window.__formrelayInstance.alive) return;
  if (window.__formrelayInstance) window.__formrelayInstance.dispose();
  else if (window.__formrelayLoaded) return; // Old source requires a page refresh after development updates.
  window.__formrelayLoaded = true;
  const documentToken = Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2,'0')).join('');
  let alive = true, creating = false, lastPublished = '', stateMessage = '', initialURL = location.href;
  let ready = Promise.resolve();
  const controls = 'input,textarea,select,[role=checkbox][aria-checked],[role=radio][aria-checked],[role=combobox],[role=listbox]';
  const native = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const checked = el => native(el) ? el.checked : el.getAttribute('aria-checked')==='true';
  const allowed = new Set(['text', 'email', 'tel', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group']);
  const sensitive = /password|passcode|one[\s_-]*time|otp|verification|security[\s_-]*code|\bauth(?:entication|orization)?\b|auth(?:code|key)|oauth|user[\s_-]*name|session|remember[\s_-]*me|csrf|xsrf|token|secret|credential|(?:cvv|cvc|card|credit|debit|payment|bank)|\b(?:pin|ssn|aadhaar|aadhar)\b|log[\s_-]*in|sign[\s_-]*in/i;
  let selecting = false, confirmationKey = null, chosen = [], tracker = null, timer = null, observer = null, refreshTimer = null, filling = 0;
  const decorations = new Map(), preChecked = new WeakMap(), requests = new Map();
  let confirmationRequest = null;
  const fieldsForView = () => tracker?.fields || chosen;
  const refsFor=f=>[...f.refs,...(f.options||[]).filter(o=>o.otherInput).map(o=>o.otherInput)];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalized = value => (value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  function labelText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true); copy.querySelectorAll?.('input,textarea,select,button,script,style,[role=option],[role=radio],[role=checkbox]').forEach(el => el.remove()); return copy.textContent;
  }
  function label(el) {
    const references = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => labelText(document.getElementById(id)) || '').join(' ').trim();
    return normalized(references || el.getAttribute('aria-label') || labelText(el.labels?.[0]) || el.placeholder || (!native(el)?labelText(el):'') || el.getAttribute('name') || el.id || 'Unlabeled field');
  }
  const questionSelector='fieldset,[role=radiogroup],[role=group],[data-question],.question,[role=listitem]';
  function question(el,fallback){
    for(let box=el.closest(questionSelector);box;box=box.parentElement?.closest(questionSelector)){
      const refs=(box.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>labelText(document.getElementById(id))||'').join(' ').trim();
      const title=[...box.querySelectorAll('legend,[role=heading],h1,h2,h3,h4,.question-title,[data-question-title]')].find(node=>node.closest(questionSelector)===box);
      const text=normalized(refs||box.getAttribute('aria-label')||labelText(title));if(text)return text;
    }
    return fallback;
  }
  function listbox(el){
    if(el.getAttribute('role')==='listbox')return el;
    const ids=(el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').split(/\s+/).filter(Boolean);
    const boxes=ids.map(id=>document.getElementById(id)).filter(node=>node?.getAttribute('role')==='listbox');return boxes.length===1?boxes[0]:null;
  }
  function canonical(el){
    if(el?.id&&native(el)&&['text','textarea'].includes(el.type)){
      const box=el.closest(questionSelector)||el.closest('label');
      const owners=box?[...box.querySelectorAll('input[type=radio],input[type=checkbox],option,[role=option]')].filter(node=>node.getAttribute('data-other-input')===el.id||node.getAttribute('aria-controls')===el.id):[];
      if(owners.length===1){const owner=owners[0];return owner.localName==='option'?owner.closest('select'):owner.getAttribute('role')==='option'?canonical(owner.closest('[role=listbox]')):owner}
    }
    if(el?.getAttribute('role')==='listbox'&&el.id){const owners=[...document.querySelectorAll('[role=combobox]')].filter(node=>listbox(node)===el);if(owners.length===1)return owners[0]}
    return el;
  }
  function customOptions(el){const box=listbox(el);return box?[...box.querySelectorAll('[role=option]')].filter(node=>node.closest('[role=listbox]')===box&&node.getAttribute('aria-disabled')!=='true').map((node,i)=>({value:'choice_'+i,label:normalized(node.getAttribute('aria-label')||node.textContent),actual:node.getAttribute('data-value')||node.id||normalized(node.textContent),node})):[]}
  function customValue(el){const options=customOptions(el),selected=options.filter(o=>o.node.getAttribute('aria-selected')==='true');return selected.length===1?selected[0].actual:''}
  function otherInput(option,el){
    const node=option.node,box=el.closest(questionSelector)||el.parentElement;
    const id=node?.getAttribute('data-other-input')||node?.getAttribute('aria-controls');
    if(id){const input=document.getElementById(id);return input&&box.contains(input)?input:null}
    if(!/^other(?:\b|:)/i.test(option.label))return null;
    const owner=node?.closest('label');if(!owner)return null;
    const candidates=[...owner.querySelectorAll('input:not([type=radio]):not([type=checkbox]),textarea')].filter(input=>input!==el);
    return candidates.length===1?candidates[0]:null;
  }
  function path(el) {
    const pieces = [];
    for (let node = el; node && node !== document.body && pieces.length < 6; node = node.parentElement) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) { pieces.unshift('#' + CSS.escape(node.id)); break; }
      pieces.unshift(node.localName + ':nth-of-type(' + ([...node.parentElement.children].filter(child => child.localName === node.localName).indexOf(node) + 1) + ')');
    }
    return pieces.join(' > ');
  }
  function members(el) {
    if(!native(el)){
      const role=el.getAttribute('role'),scope=role==='radio'?'[role=radiogroup]':questionSelector,group=el.closest(scope);
      if(group&&(role==='radio'||question(el,''))){const refs=[...group.querySelectorAll('[role='+role+'][aria-checked]')].filter(ref=>ref.closest(scope)===group);if(refs.length>1||role==='radio')return refs}
      return [el];
    }
    if(el.type==='checkbox'){
      const group=el.closest(questionSelector);
      if(group&&question(el,'')){
        const peers=[...group.querySelectorAll('input[type=checkbox]')].filter(ref=>ref.form===el.form&&ref.closest(questionSelector)===group);
        const other=peers.find(ref=>/^other(?:\b|:)/i.test(label(ref)));
        if(peers.length>1&&(peers.every(ref=>ref.name&&ref.name===el.name)||!group.querySelector('input:not([type=checkbox]),textarea,select')||other&&otherInput({node:other,label:label(other)},el)))return peers;
      }
      return [el];
    }
    if (el.type !== 'radio' || !el.name) return [el];
    return [...document.querySelectorAll('input[type=radio]')].filter(other => other.name === el.name && other.form === el.form);
  }
  function describe(el) {
    el=canonical(el);
    let type = el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : native(el)?el.type:el.getAttribute('role');
    const customSelect=!native(el)&&['combobox','listbox'].includes(type);if(customSelect)type='select';
    const refs = members(el);
    if(type==='checkbox'&&refs.length>1)type='checkbox-group';
    const title = question(el, '') || label(el);
    const options = customSelect?customOptions(el):type === 'select' ? [...el.options].filter(option => option.value !== '' && !option.disabled && !option.closest('optgroup[disabled]')).map((option, i) => ({value: 'choice_' + i, label: normalized(option.label), actual: option.value, node: option})) : (type === 'radio'||type==='checkbox-group') ? refs.map((radio, i) => ({value: 'choice_' + i, label: label(radio), actual: radio.value??radio.getAttribute('data-value')??label(radio), node: radio})) : null;
    if(options)for(const option of options){option.otherInput=otherInput(option,el);option.other=!!option.otherInput;const owner=option.node?.closest('label');option.otherIssue=!option.otherInput&&(!!(option.node?.getAttribute('data-other-input')||option.node?.getAttribute('aria-controls'))||/^other(?:\b|:)/i.test(option.label)&&!!owner?.querySelector('input:not([type=radio]):not([type=checkbox]),textarea'));}
    return {el, refs, type, customSelect,label: title, name: el.getAttribute('name') || '', id: el.id || '', form: el.form||el.closest('form'), step:location.href, path: path(el), required: refs.some(ref => ref.required||ref.getAttribute('aria-required')==='true'), options};
  }
  function reason(f, requireEmpty = false) {
    if(f.label.length>1000)return 'Question text exceeds the supported 1000-character limit; review manually';
    if(f.type!=='select'&&f.el.closest('[role=combobox]'))return 'Custom dropdown needs a verified adapter; it is not delegated as free text';
    if(f.customSelect&&(!['div','span','button'].includes(f.el.localName)||(f.el.localName==='button'&&f.el.type!=='button')||!f.el.hasAttribute('tabindex')||!listbox(f.el)||listbox(f.el).getAttribute('aria-multiselectable')==='true'||f.el.querySelector('input,textarea,select,[contenteditable=true]')||f.options.some(o=>o.node.closest('button,a')||o.node.querySelector('input,textarea,select,button,a,[contenteditable=true]'))))return 'Unsupported dropdown contract. Use a single-choice accessible listbox with loaded options; editable or unsafe widgets are unsupported';
    if (!allowed.has(f.type)) return 'Unsupported input type: ' + f.type;
    if (f.form?.querySelector('input[type=password]')) return 'Authentication form containing a password field';
    if (f.type === 'select' && f.el.multiple) return 'Multiple-select controls are not supported';
    for (const el of f.refs) {
      if(!native(el)&&!f.customSelect&&(!['div','span'].includes(el.localName)||!el.hasAttribute('tabindex')||el.tabIndex < -1||!['true','false'].includes(el.getAttribute('aria-checked'))||el.closest('button,a,[role=button],[role=link]')||el.querySelector('input,textarea,select,[contenteditable=true]')))return 'Custom control lacks a safe accessible read/activate contract';
      if(!native(el)&&el.getAttribute('role')==='radio'&&!el.closest('[role=radiogroup]'))return 'Custom radio needs an accessible radiogroup';
      const context = [f.label, label(el), el.name, el.id, el.autocomplete, f.form?.getAttribute('id'), f.form?.getAttribute('name'), f.form?.getAttribute('action')].map(normalized).join(' ');
      if (sensitive.test(context) || /^(?:username|current-password|new-password|one-time-code|cc-)/i.test(el.autocomplete || '')) return 'Sensitive or authentication-related field';
      if (el.disabled || el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled')==='true'||el.getAttribute('aria-readonly')==='true') return 'Disabled or read-only';
      if (!el.isConnected || el.getClientRects().length === 0 || ![...el.getClientRects()].some(rect=>rect.width>0&&rect.height>0) || getComputedStyle(el).visibility !== 'visible' || el.closest('[hidden],[inert],[contenteditable=true]')) return 'Hidden, detached, or non-editable';
    }
    for(const option of f.options||[]){const input=option.otherInput;if(option.otherIssue||input&&(!((input instanceof HTMLInputElement&&input.type==='text')||input instanceof HTMLTextAreaElement)||input.form!==f.form||sensitive.test([label(input),input.id,input.name,input.autocomplete].map(normalized).join(' '))||/^(?:username|current-password|new-password|one-time-code|cc-)/i.test(input.autocomplete||'')||input.readOnly||input.getAttribute('aria-readonly')==='true'))return 'Other text control is sensitive, ambiguous or unsupported';}
    if (f.options && (!f.options.length || f.options.length > 50 || f.options.some(option => !option.label))) return 'Requires 1-50 labelled, enabled choices';
    if(f.options?.some(option=>option.label.length>500))return 'Choice text exceeds the supported 500-character limit; review manually';
    if (f.options && ((f.type!=='checkbox-group'&&new Set(f.options.map(o => o.actual)).size !== f.options.length) || new Set(f.options.map(o => o.label)).size !== f.options.length)) return 'Ambiguous choice labels or values; review manually';
    if (requireEmpty && (f.type === 'checkbox' ? checked(f.el) : (f.type === 'radio'||f.type==='checkbox-group') ? f.refs.some(checked) : f.customSelect?customValue(f.el)!=='':f.el.value.trim() !== '')) return 'Already contains an answer';
    return '';
  }
  function definition(f) {
    return {key: f.key, label: f.label, type: f.type, ...((f.type === 'checkbox'||f.type==='checkbox-group') ? {required: f.required} : {}), ...(f.options ? {options: f.options.map(({value, label,other}) => ({value, label,...(other?{other:true}:{})}))} : {})};
  }
  function sameChoices(a, b, actual = true) {
    return JSON.stringify((a.options || []).map(o => [o.label,!!o.other, ...(actual ? [o.actual] : [])])) === JSON.stringify((b.options || []).map(o => [o.label,!!o.other, ...(actual ? [o.actual] : [])]));
  }
  function mapping(f, requireEmpty = false) {
    if (!f.el || !f.refs.length || f.refs.some(el => !el.isConnected)) return 'Page replaced the selected control; confirm its replacement';
    const now = describe(f.el);
    if (now.type !== f.type || now.label !== f.label || now.name !== f.name || now.id !== f.id || now.form !== f.form || now.step !== f.step || now.required !== f.required || !sameChoices(f, now) || now.refs.length !== f.refs.length || now.refs.some((el, i) => el !== f.refs[i]) || (f.options||[]).some((o,i)=>o.otherInput!==now.options[i]?.otherInput)) return 'Field identity or choices changed; confirm the mapping';
    return reason(now, requireEmpty);
  }
  function paint(el, mode) {
    if (!decorations.has(el)) decorations.set(el, {outline: el.style.outline, background: el.style.background, title: el.title});
    el.style.outline = mode === 'hover' ? '3px solid #5274fa' : mode === 'selected' ? '3px solid #159260' : mode === 'pending' ? '3px solid #b56b00' : mode === 'failed' ? '3px solid #bc243c' : '2px dashed #5274fa';
    if (mode === 'verified') { el.style.outline = '3px solid #159260'; el.style.background = '#d8f8e6'; el.title = 'Filled by FormRelay - verified after page events; review before submitting'; }
  }
  function restore(el) {
    const saved = decorations.get(el);
    if (saved) { el.style.outline = saved.outline; el.style.background = saved.background; el.title = saved.title; decorations.delete(el); }
  }
  function chosenFor(el) { return chosen.find(f => f.refs.includes(el)); }
  function heldFor(el) { return [...requests.values()].flatMap(r=>r.fields).find(f=>f.refs.includes(el)); }
  function refresh() {
    if (selecting) for (const el of [...document.querySelectorAll(controls)].slice(0, 1000)) {
      if (chosenFor(el)) paint(el, 'selected');
      else if (!reason(describe(el))) paint(el, 'supported');
      else if(!heldFor(el))restore(el);
    }
    for (const el of [...decorations.keys()]) if (!el.isConnected && !chosenFor(el)) decorations.delete(el);
    update();
  }
  function watch() {
    if (observer) return;
    observer = new MutationObserver(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(()=>{
      if(location.href!==initialURL){initialURL=location.href;status('Page step changed. Mappings are revalidated before filling; replaced fields need confirmation.')}
      if(selecting)refresh();else if(!filling)for(const r of requests.values()){if(r.answers){const deferred=r.fields.filter(f=>f.state==='deferred'&&!mapping(f));if(deferred.length)apply(r.answers,deferred,r)}}
    }, 120); });
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'name', 'type', 'disabled', 'readonly', 'hidden', 'class', 'multiple', 'required', 'autocomplete', 'aria-label', 'aria-labelledby','aria-checked','aria-disabled','aria-readonly']});
  }
  function publicState() {
    const view=r=>({id:r.id,base:r.base,sourcePath:r.sourcePath||location.pathname,url:r.url||r.base+'/r/'+r.id,expiresAt:r.expiresAt,phase:r.phase,fields:r.fields.map(definition),results:r.fields.map(f=>({key:f.key,label:f.label,type:f.type,state:f.state,detail:f.detail||'',needsConfirmation:f.state==='confirmation',needsOverwrite:f.state==='overwrite'}))});
    return {version:VERSION,origin:location.origin,documentToken,selecting,creating,busy:filling>0,status:stateMessage,selection:chosen.map(definition),request:tracker?view(tracker):null,requests:[...requests.values()].map(view)};
  }
  function runtimeCall(message) {
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Extension operation timed out. Reopen the popup and retry.')),10000);
      const fail=error=>{clearTimeout(timeout);if(/context invalidated/i.test(error.message))dispose();reject(error)};
      try { chrome.runtime.sendMessage(message,response=>{
        try{const error=chrome.runtime.lastError;if(error){fail(Error(error.message));return}clearTimeout(timeout);resolve(response||{ok:true})}catch(error){fail(error)}
      }); } catch(error){fail(error)}
    });
  }
  function publish() {
    if(!alive)return;
    const state=publicState(), serialized=JSON.stringify(state);
    if(serialized===lastPublished)return;lastPublished=serialized;
    runtimeCall({action:'STATE_UPDATE',documentToken,state}).catch(()=>{});
  }
  function update() { publish(); }
  function status(message) { stateMessage=message;publish(); }
  function idleObserver() {
    if(!selecting&&!confirmationKey&&![...requests.values()].some(r=>!['expired','unauthorized'].includes(r.phase)&&(!r.done||r.fields.some(f=>['deferred','confirmation'].includes(f.state))))){observer?.disconnect();observer=null;clearTimeout(refreshTimer)}
  }
  function reset() {
    if(creating)throw Error('Wait for request creation to finish.');
    stop();for(const el of [...decorations.keys()])restore(el);chosen=[];tracker=null;idleObserver();status('Draft cleared. Earlier requests are still tracked in Requests.');
  }
  function dispose() {
    if(!alive)return;alive=false;if(window.__formrelayInstance)window.__formrelayInstance.alive=false;stop();clearInterval(timer);clearTimeout(refreshTimer);observer?.disconnect();observer=null;
    document.removeEventListener('mouseover',hover,true);document.removeEventListener('mouseout',unhover,true);
    try{chrome.runtime.onMessage.removeListener?.(listener)}catch{}window.removeEventListener('pagehide',dispose);for(const el of [...decorations.keys()])restore(el);
    if(window.__formrelayInstance)window.__formrelayInstance.alive=false;
  }
  function hover(event){const el=target(event);if(el&&!chosenFor(el)&&!reason(describe(el)))paint(el,'hover')}
  function unhover(event){const el=target(event);if(el&&!chosenFor(el)&&!reason(describe(el)))paint(el,'supported')}
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function remember(event) { const el = target(event); if (el) { members(el).forEach(ref => preChecked.set(ref, checked(ref))); if (event.type === 'pointerdown') event.preventDefault(); } }
  function selectionReason(f) {
    const unsafe = reason(f, false); if (unsafe) return unsafe;
    if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group') {
      if (!preChecked.has(f.el)) return 'Click this control directly to confirm its unanswered state';
      return '';
    }
    return reason(f);
  }
  function keyguard(event) { if (event.key === 'Enter') block(event); if (event.key === ' ') remember(event); }
  function target(event) {
    if (!(event.target instanceof Element)) return null;
    const direct = event.target.closest(controls);
    return canonical(direct || event.target.closest('label')?.control || null);
  }
  function stop() {
    selecting = false; confirmationKey = null;confirmationRequest=null;
    document.removeEventListener('click', pick, true);
    document.removeEventListener('pointerdown', remember, true);
    if (!filling) document.removeEventListener('submit', block, true);
    document.removeEventListener('mouseover',hover,true);document.removeEventListener('mouseout',unhover,true);
    document.removeEventListener('keydown', keyguard, true);
    for (const el of [...decorations.keys()]) if (!heldFor(el)&&(!chosenFor(el)||chosenFor(el).state==='selected')) restore(el);
    idleObserver();publish();
  }
  function activate() {
    document.addEventListener('click', pick, true);
    document.addEventListener('pointerdown', remember, true);
    document.addEventListener('mouseover',hover,true);document.addEventListener('mouseout',unhover,true);
    document.addEventListener('submit', block, true);
    document.addEventListener('keydown', keyguard, true);
    watch();
  }
  function start() {
    if (filling||creating) throw Error('Wait for the current operation to finish');
    stop(); tracker=null; for (const el of [...decorations.keys()]) if(!heldFor(el))restore(el);
    chosen = []; selecting = true; activate(); refresh();status('Selection mode active. Click supported unanswered fields.');
  }
  function pick(event) {
    const button = event.target instanceof Element && event.target.closest('button,input[type=submit],input[type=image]');
    if (button && (!(button instanceof HTMLButtonElement) || button.type !== 'button')) { block(event); return; }
    const el = target(event); if (!el) return;
    const f = describe(el); block(event);
    if (confirmationKey) {
      const active=confirmationRequest,item = (active?.fields||chosen).find(item => item.key === confirmationKey);
      if (!item || selectionReason(f) || f.type !== item.type || f.label !== item.label || f.required !== item.required || !sameChoices(f, item, false) || [...chosen,...(active?.fields||[])].some(other => other !== item && other.refs.some(ref => f.refs.includes(ref)))) { status('Replacement is incompatible, sensitive, already filled, or selected elsewhere. Choose the matching unanswered control.'); return; }
      for (const ref of item.refs) restore(ref);
      Object.assign(item, f, {state: 'selected', detail: 'Mapping confirmed by clicking the replacement'});
      stop(); item.refs.forEach(ref => paint(ref, 'selected')); update();
      if (active?.answers) setTimeout(() => apply(active.answers, [item],active), 0);
      return;
    }
    const existing = chosenFor(el);
    if (existing) { chosen = chosen.filter(item => item !== existing); existing.refs.forEach(restore); refresh();status(existing.label+' deselected.'); return; }
    const unsupported = selectionReason(f);
    if (unsupported) { status(unsupported); return; }
    if (chosen.length >= 20) { status('Select at most 20 fields'); return; }
    chosen.push({...f, key: 'field_' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), state: 'selected', detail: ''});
    f.refs.forEach(ref => paint(ref, 'selected')); status(f.label+' selected.');update();
  }
  function compatibility() {
    const all = [], seen = new Set();
    const candidates = [...document.querySelectorAll(controls)];
    for (const el of candidates.slice(0, 1000)) {
      if (seen.has(canonical(el))) continue;
      const f = describe(el); f.refs.forEach(ref => seen.add(ref));
      const selected = chosenFor(el);
      all.push({label: f.label, type: f.type, location: (f.form?.getAttribute('id') || f.form?.getAttribute('name') || 'page') + ' / ' + f.path, supported: !reason(f), reason: reason(f), selected: !!selected});
    }
    for(const el of [...document.querySelectorAll('[role=combobox],[role=listbox],[role=textbox],[contenteditable=true]')].slice(0,100)){if(!el.matches(controls))all.push({label:label(el),type:'custom '+(el.getAttribute('role')||'rich text'),location:path(el),supported:false,reason:'Custom widget needs a verified value adapter',selected:false})}
    const pending = fieldsForView().map(f => ({key: f.key, label: f.label, state: f.state, detail: f.detail || mapping(f), needsConfirmation: f.state === 'confirmation' || (f.state === 'selected' && !!mapping(f)),needsOverwrite:f.state==='overwrite'}));
    return {fields: all, selected: pending, busy: filling > 0, duplicates: all.filter((f, i) => all.some((other, j) => i !== j && f.label === other.label)).length, frames: document.querySelectorAll('iframe,frame').length, custom: [...document.querySelectorAll('[role=combobox],[role=listbox],[role=textbox],[role=checkbox],[role=radio]')].filter(el=>!native(el)&&!el.matches('[role=checkbox][aria-checked],[role=radio][aria-checked]')).length, truncated: candidates.length > 1000, limitations: 'Native and verified single-choice ARIA dropdown contracts in this document. Load dropdown options before selection. Iframes, shadow DOM, editable/custom search widgets, multiple-select and trusted-event-only controls are unsupported. Filled fields require overwrite confirmation.'};
  }
  function setNative(el, property, value) {
    if(!native(el)){if(property!=='checked')throw Error('Unsupported custom value setter');if(checked(el)!==value)el.click();return}
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, property).set.call(el, value);
  }
  function events(el, checkable = false) {
    // A generic Event('click') informs React checkable trackers without native
    // MouseEvent activation, label clicks, element.click(), or form submission.
    if (checkable && native(el)) el.dispatchEvent(new Event('click', {bubbles: true}));
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  function values(f) { return f.refs.map(el => f.type === 'radio' || f.type === 'checkbox' || f.type === 'checkbox-group' ? checked(el) : f.customSelect?customValue(el):el.value).concat((f.options||[]).filter(o=>o.otherInput).map(o=>o.otherInput.value)); }
  function expectedMain(f, answer) {
    if (f.type === 'checkbox') return typeof answer === 'boolean' && (!f.required || answer) ? [answer] : null;
    if(f.type==='checkbox-group')return Array.isArray(answer)&&new Set(answer).size===answer.length&&answer.every(value=>f.options.some(o=>o.value===value))&&(!f.required||answer.length)?f.options.map(o=>answer.includes(o.value)):null;
    if (f.type === 'radio') return typeof answer === 'string' && f.options.some(o => o.value === answer) ? f.options.map(o => o.value === answer) : null;
    if (f.type === 'select') { const option = f.options.find(o => o.value === answer); return option ? [option.actual] : null; }
    return typeof answer === 'string' && answer.length <= 500 ? [answer] : null;
  }
  function expected(f,raw){
    const structured=raw&&typeof raw==='object'&&!Array.isArray(raw),answer=structured?raw.value:raw;
    const main=expectedMain(f,answer);if(!main)return null;
    const selected=Array.isArray(answer)?answer:[answer],custom=(f.options||[]).filter(o=>o.otherInput);
    if(structured&&(!raw.other||typeof raw.other!=='object'||Array.isArray(raw.other)||Object.keys(raw.other).some(k=>!custom.some(o=>o.value===k&&selected.includes(k)))))return null;
    const texts=[];for(const o of custom){if(selected.includes(o.value)){const text=raw.other?.[o.value];if(typeof text!=='string'||!text.trim()||text.length>500)return null;texts.push(text)}else texts.push(o.otherInput.value)}
    return main.concat(texts);
  }
  async function write(f,wanted){
    if(f.customSelect){
      const option=f.options.find(o=>o.actual===wanted[0]);if(!option)throw Error('Dropdown answer is not an offered option');
      if(!option.node.getClientRects().length){f.el.click();await delay(0)}
      const issue=mapping(f,false);if(issue)throw Error(issue);
      const current=describe(f.el).options.find(o=>o.actual===option.actual);
      if(!current?.node.getClientRects().length||getComputedStyle(current.node).visibility!=='visible')throw Error('Dropdown options are not accessible; open it and retry');
      current.node.click();events(f.el);
    }else{
      f.refs.forEach((el,i)=>setNative(el,['checkbox','radio','checkbox-group'].includes(f.type)?'checked':'value',wanted[i]));
      for(const el of f.refs)events(el,f.type==='checkbox'||f.type==='checkbox-group'||f.type==='radio'&&checked(el));
    }
    const custom=(f.options||[]).filter(o=>o.otherInput);if(custom.length)await delay(0);
    for(const [i,o] of custom.entries()){const text=wanted[f.refs.length+i];if(text===o.otherInput.value)continue;if(!o.otherInput.isConnected||o.otherInput.disabled||o.otherInput.readOnly||o.otherInput.getAttribute('aria-disabled')==='true'||o.otherInput.closest('[hidden],[inert],[contenteditable=true]')||!o.otherInput.getClientRects().length||getComputedStyle(o.otherInput).visibility!=='visible')throw Error('Other text input did not become editable');setNative(o.otherInput,'value',text);events(o.otherInput)}
  }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  async function apply(answers, items, active) {
    if (!answers || typeof answers !== 'object') return;
    // Block normal submit events throughout framework processing. Never call
    // submit/requestSubmit or synthesize an activating button/MouseEvent click.
    filling++;active.phase='received';publish();
    document.addEventListener('submit', block, true);
    const attempted = [];
    try {
      for (const f of items) {
        if (f.state === 'verified' || f.state === 'applying' || !Object.hasOwn(answers, f.key)) continue;
        const issue = mapping(f);
        if (issue) { f.state = /confirm|replaced/.test(issue) ? 'confirmation' : /Hidden/.test(issue) ? 'deferred' : 'skipped'; f.detail = issue; f.refs.filter(el => el.isConnected).forEach(el => paint(el, 'pending')); continue; }
        const wanted = expected(f, answers[f.key]);
        if (!wanted) { f.state = 'failed'; f.detail = 'Response did not match the selected type or choices'; continue; }
        const before = values(f);
        if(before.some(value=>value!==false&&value!=='')&&!equal(before,wanted)&&!equal(before,f.overwriteApproved)){f.state='overwrite';f.detail='Existing answer preserved. Confirm replacement in Requests to insert the new answer.';continue}
        f.state = 'applying'; f.detail = 'Waiting for page processing';
        try{await write(f,wanted)}catch(error){f.state='failed';f.detail=error.message;continue}
        const invalid = refsFor(f).some(el => (el.validity&&!el.validity.valid) || (el.maxLength >= 0 && el.value.length > el.maxLength) || (el.minLength > 0 && el.value.length < el.minLength));
        if (invalid) {try{await write(f,before)}catch{}f.state = 'failed'; f.detail = 'Answer violates the original field constraints'; f.refs.forEach(el => paint(el, 'failed')); continue; }
        attempted.push({f, before, wanted});
      }
      // Check twice: synchronous success alone misses controlled-input reverts.
      if (attempted.length) await delay(150);
      for (const attempt of attempted) attempt.first = attempt.f.refs.every(el => el.isConnected) && equal(values(attempt.f), attempt.wanted);
      if (attempted.length) await delay(500);
      if(!alive)return;
      for (const {f, before, wanted, first} of attempted) {
        if (first && f.refs.every(el => el.isConnected) && equal(values(f), wanted) && !mapping(f, false) && f.refs.every(el => !el.validity||el.validity.valid)) {
          f.state = 'verified'; f.detail = 'Value retained after input/change events and two delayed checks'; active.previous.set(f.key, {f, before, wanted}); f.refs.forEach(el => paint(el, 'verified'));
        } else { f.state = f.refs.some(el => !el.isConnected) || /confirm/.test(mapping(f, false)) ? 'confirmation' : 'failed'; f.detail = f.state === 'confirmation' ? 'Page replaced this control while processing; confirm replacement' : 'The page rejected or changed the value; review manually'; f.refs.filter(el => el.isConnected).forEach(el => paint(el, 'failed')); }
      }
      active.phase=active.fields.every(f=>f.state==='verified')?'completed':'partial';
      status(active.fields.filter(f => f.state === 'verified').length + '/' + active.fields.length + ' fields verified for request '+active.id.slice(0,8)+'. Review values before submitting.');
    } finally { filling--;idleObserver();publish(); if (!filling && !selecting && !confirmationKey) document.removeEventListener('submit', block, true); }
  }
  async function poll(active) {
    if(!active||active.done||active.polling||!alive)return;
    if(active.expiresAt&&Date.now()>=active.expiresAt){active.done=true;active.phase='expired';idleObserver();status('Request '+active.id.slice(0,8)+' expired. Other requests remain active.');return}
    const interval=Math.max(2500,[...requests.values()].filter(r=>!r.done).length*500);
    if(active.lastPoll&&Date.now()-active.lastPoll<interval)return;
    active.lastPoll=Date.now();active.polling=true;
    try {
      const response=await runtimeCall({action:'FETCH',base:active.base,path:'/api/requests/'+active.id+'/status',token:active.token});
      if(!alive||requests.get(active.id)!==active||active.done)return;
      if(active.expiresAt&&Date.now()>=active.expiresAt){active.done=true;active.phase='expired';idleObserver();publish();return}
      if(!response.ok){
        if(response.status===404||response.status===403){active.done=true;active.phase=response.status===404?'expired':'unauthorized';idleObserver();status(response.status===404?'Request expired or backend restarted. Create a new request.':'Response access denied. Start a new request from the original tab.');return}
        active.phase='offline';status(response.error||'Backend unavailable. Retrying automatically; check your server.');return;
      }
      if(response.data?.submitted){active.done=true;active.phase='received';active.answers=response.data.answers;status('Response received. Verifying inserted values.');if(!selecting&&!confirmationKey&&!creating&&!filling)await apply(active.answers,active.fields,active)}
      else if(active.phase!=='waiting'){active.phase='waiting';status('Connected. Waiting for the recipient.');}
    }catch(error){if(alive&&requests.get(active.id)===active)status('Connection interrupted. Retrying automatically. '+error.message)}finally{active.polling=false}
  }
  function pollAll(){for(const active of requests.values()){if(active.answers&&active.phase==='received'&&!selecting&&!confirmationKey&&!creating&&!filling)apply(active.answers,active.fields,active);else poll(active)}if([...requests.values()].every(r=>r.done&&r.phase!=='received')){clearInterval(timer);timer=null}}
  // Check due times frequently; poll() still enforces the per-request HTTP interval.
  // A newly added request must not miss an entire tick of the older request's timer.
  function startPolling(){if(!timer)timer=setInterval(pollAll,500);pollAll()}
  function undo(active) {
    document.addEventListener('submit', block, true);
    try {
      for (const {f, before, wanted} of active.previous.values()) {
        if([...requests.values()].reverse().find(r=>r.fields.some(other=>refsFor(other).some(el=>refsFor(f).includes(el))))!==active)continue;
        if (f.refs.some(el => !el.isConnected) || !equal(values(f), wanted)) continue; // Preserve later user edits.
        if(f.customSelect||(f.options||[]).some(o=>o.otherInput)){f.state='undo-unavailable';f.detail='Review this compound/custom control manually; automatic undo is unsupported.';continue}
        if(f.type==='radio'&&f.refs.some(el=>!native(el))&&before.every(value=>!value)){f.state='undo-unavailable';f.detail='Custom radios cannot safely clear an entire answered group. Review manually.';continue}
        f.refs.forEach((el, i) => { setNative(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group' ? 'checked' : 'value', before[i]); events(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group'); restore(el); });
        f.state = 'undone'; f.detail = 'Restored; review the original page';
      }
      active.previous.clear();active.phase='partial';
    } finally { if (!selecting && !confirmationKey) document.removeEventListener('submit', block, true); }
  }
  const listener=(msg,sender,reply)=>{
    (async()=>{
      if(msg.action==='PING'){reply({ok:true,version:VERSION,documentToken});return}
      await ready;
      if(msg.documentToken&&msg.documentToken!==documentToken)throw Error('The page changed during request creation. Reopen FormRelay to confirm mappings.');
      if(msg.action==='GET_STATE'){if(!creating)await recoverContext();reply({...publicState(),ok:true});return}
      if(msg.action==='GET_SELECTION'){reply({fields:chosen.map(definition),issues:chosen.filter(f=>f.state!=='verified'&&mapping(f)).map(f=>({key:f.key,label:f.label,detail:mapping(f)}))});return}
      if(msg.action==='SCAN_FIELDS'){
        const all = [], seen = new Set();
        const candidates = [...document.querySelectorAll(controls)];
        let idx = 0;
        for (const el of candidates.slice(0, 100)) {
          if (seen.has(canonical(el))) continue;
          const f = describe(el);
          f.refs.forEach(ref => seen.add(ref));
          if (!reason(f)) {
            const key = f.id ? 'id_' + f.id : f.name ? 'name_' + f.name : ('fld_' + idx);
            all.push({
              key,
              idx,
              label: f.label,
              type: f.type,
              options: f.options ? f.options.map(o => ({ value: o.value, label: o.label })) : []
            });
            idx++;
          }
        }
        reply({ ok: true, fields: all });
        return;
      }
      if(msg.action==='SET_SELECTION'){
        stop();
        chosen.forEach(f => f.refs.forEach(restore));
        chosen = [];
        const targetKeys = new Set((msg.keys || []).map(String));
        const candidates = [...document.querySelectorAll(controls)];
        const seen = new Set();
        let idx = 0;
        for (const el of candidates.slice(0, 100)) {
          if (seen.has(canonical(el))) continue;
          const f = describe(el);
          f.refs.forEach(ref => seen.add(ref));
          if (!reason(f)) {
            const key = f.id ? 'id_' + f.id : f.name ? 'name_' + f.name : ('fld_' + idx);
            if (targetKeys.has(key) || targetKeys.has('fld_' + idx) || targetKeys.has(String(idx))) {
              const chosenItem = {
                ...f,
                key: 'field_' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join(''),
                state: 'selected',
                detail: ''
              };
              chosen.push(chosenItem);
              f.refs.forEach(ref => paint(ref, 'selected'));
            }
            idx++;
          }
        }
        update();
        refresh();
        reply({ ok: true, count: chosen.length });
        return;
      }
      if(msg.action==='CHECK'){reply(compatibility());return}
      if(msg.action==='PREPARE_REQUEST'){
        if(creating||filling)throw Error('Wait for the current operation to finish.');
        if(!chosen.length||chosen.some(f=>mapping(f)))throw Error('Select unanswered fields and resolve changed mappings first.');
        stop();creating=true;status('Creating a secure request.');reply({ok:true,documentToken,fields:chosen.map(definition),contextFields:chosen.map(f=>({...definition(f),required:f.required}))});return;
      }
      if(msg.action==='CREATE_FAILED'){creating=false;status(typeof msg.error==='string' && msg.error ? msg.error : 'Request creation failed. Check Settings and retry.');reply({ok:true});return}
      if(msg.action==='START'){start();reply({ok:true});return}
      if(msg.action==='STOP'){stop();status('Selection finished. Review your selected questions.');reply({ok:true});return}
      if(msg.action==='CLEAR'||msg.action==='NEW_REQUEST'){reset();reply({ok:true});return}
      if(msg.action==='REMOVE_FIELD'){
        if(creating||filling)throw Error('Wait for the current operation to finish.');
        const f=chosen.find(f=>f.key===msg.key);if(f){f.refs.forEach(restore);chosen=chosen.filter(item=>item!==f);status(f.label+' removed.');refresh()}reply({ok:true});return;
      }
      if(msg.action==='CONFIRM_MAPPING'){
        if(filling||creating)throw Error('Wait for page processing before confirming another mapping');
        const active=msg.requestId?requests.get(msg.requestId):tracker;
        const item=(active?.fields||chosen).find(f=>f.key===msg.key);if(!item)throw Error('Selected field not found');
        if(active&&['expired','unauthorized'].includes(active.phase))throw Error('This request is no longer available.');
        stop();confirmationKey=item.key;confirmationRequest=active;activate();status('Click the matching unanswered replacement for '+item.label);reply({ok:true});return;
      }
      if(msg.action==='CONFIRM_OVERWRITE'){
        if(filling||creating||selecting||confirmationKey)throw Error('Finish the current operation first');
        const active=requests.get(msg.requestId),item=active?.fields.find(f=>f.key===msg.key);
        if(!item||item.state!=='overwrite'||!active.answers)throw Error('No pending overwrite for this request');
        const issue=mapping(item,false);if(issue)throw Error(issue);
        item.overwriteApproved=values(item);apply(active.answers,[item],active);reply({ok:true});return;
      }
      if(msg.action==='TRACK'){
        if(requests.has(msg.track.id)){reply({ok:true});return}
        if(!chosen.length)throw Error('The draft mappings are unavailable; reopen the original page to recover this request.');
        stop();creating=false;tracker={...msg.track,fields:chosen,previous:new Map(),done:false,phase:'waiting'};requests.set(tracker.id,tracker);chosen=[];for(const f of tracker.fields)f.refs.forEach(el=>paint(el,'pending'));watch();status('Request ready. Earlier requests remain active.');startPolling();reply({ok:true});return;
      }
      if(msg.action==='SELECT_REQUEST'){tracker=requests.get(msg.requestId)||null;publish();reply({ok:true});return}
      if(msg.action==='UNDO'){if(filling)throw Error('Wait for page processing before undo');const active=msg.requestId?requests.get(msg.requestId):tracker;if(!active)throw Error('Request not found in this document');undo(active);status('Restored unchanged filled controls where possible. Review the page.');reply({ok:true});return}
      throw Error('Unknown content operation');
    })().catch(error=>reply({ok:false,error:error.message}));return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.__formrelayInstance={version:VERSION,alive:true,dispose};
  window.addEventListener('pagehide',dispose,{once:true});
  async function recoverContext(){const response=await runtimeCall({action:'INIT',documentToken});
    const restored=response.requests||(response.request?[response.request]:[]);
    if(restored.length){
      let added=false;
      for(const r of restored){if(requests.has(r.id))continue;added=true;const phase=r.view?.phase||r.phase||'waiting',done=['completed','expired','unauthorized'].includes(phase);tracker={...r,done,phase:done?phase:'waiting',previous:new Map(),fields:r.fields.map(f=>({...f,required:!!f.required,refs:[],el:null,state:done?(phase==='completed'?'verified':'skipped'):'confirmation',detail:'Page navigation or extension update: click to confirm this mapping'}))};requests.set(r.id,tracker)}
      if(!added)return;
      tracker=requests.get(response.request?.id)||tracker;
      status('Requests restored. Confirm mappings before answers can be inserted into replaced controls.');watch();startPolling();idleObserver();
    }else if(response.notice)status(response.notice);
    publish();

  }
  ready=recoverContext().catch(()=>{});
})();
