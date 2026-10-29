(() => {
  const VERSION = '0.4.0';
  if (window.__formrelayInstance?.version === VERSION && window.__formrelayInstance.alive) return;
  if (window.__formrelayInstance) window.__formrelayInstance.dispose();
  else if (window.__formrelayLoaded) return; // Old source requires a page refresh after development updates.
  window.__formrelayLoaded = true;
  const documentToken = Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2,'0')).join('');
  let alive = true, creating = false, lastPublished = '', stateMessage = '', initialURL = location.href;
  let ready = Promise.resolve();
  const controls = 'input,textarea,select,[role=checkbox][aria-checked],[role=radio][aria-checked]';
  const native = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const checked = el => native(el) ? el.checked : el.getAttribute('aria-checked')==='true';
  const allowed = new Set(['text', 'email', 'tel', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group']);
  const sensitive = /password|passcode|one[\s_-]*time|otp|verification|security[\s_-]*code|\bauth(?:entication|orization)?\b|auth(?:code|key)|oauth|user[\s_-]*name|session|remember[\s_-]*me|csrf|xsrf|token|secret|credential|(?:cvv|cvc|card|credit|debit|payment|bank)|\b(?:pin|ssn|aadhaar|aadhar)\b|log[\s_-]*in|sign[\s_-]*in/i;
  let selecting = false, confirmationKey = null, chosen = [], tracker = null, timer = null, observer = null, refreshTimer = null, filling = 0;
  const decorations = new Map(), previous = new Map(), preChecked = new WeakMap();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalized = value => (value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  function labelText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true); copy.querySelectorAll?.('input,textarea,select,button,script,style').forEach(el => el.remove()); return copy.textContent;
  }
  function label(el) {
    const references = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => labelText(document.getElementById(id)) || '').join(' ').trim();
    return normalized(labelText(el.labels?.[0]) || references || el.getAttribute('aria-label') || el.placeholder || (!native(el)?labelText(el):'') || el.getAttribute('name') || el.id || 'Unlabeled field').slice(0, 100);
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
      const role=el.getAttribute('role'),group=el.closest(role==='radio'?'[role=radiogroup]':'[role=group]');
      if(group&&(role==='radio'||group.hasAttribute('aria-label')||group.hasAttribute('aria-labelledby'))){const refs=[...group.querySelectorAll('[role='+role+'][aria-checked]')].filter(ref=>ref.closest(role==='radio'?'[role=radiogroup]':'[role=group]')===group);if(refs.length>1||role==='radio')return refs}
      return [el];
    }
    if(el.type==='checkbox'){
      const group=el.closest('fieldset,[role=group]');
      if(group&&(group.querySelector('legend')||group.getAttribute('aria-label')||group.getAttribute('aria-labelledby'))){
        const peers=[...group.querySelectorAll('input[type=checkbox]')].filter(ref=>ref.form===el.form&&ref.closest('fieldset,[role=group]')===group);
        if(peers.length>1&&(peers.every(ref=>ref.name&&ref.name===el.name)||!group.querySelector('input:not([type=checkbox]),textarea,select')))return peers;
      }
      return [el];
    }
    if (el.type !== 'radio' || !el.name) return [el];
    return [...document.querySelectorAll('input[type=radio]')].filter(other => other.name === el.name && other.form === el.form);
  }
  function describe(el) {
    let type = el instanceof HTMLTextAreaElement ? 'textarea' : el instanceof HTMLSelectElement ? 'select' : native(el)?el.type:el.getAttribute('role');
    const refs = members(el);
    if(type==='checkbox'&&refs.length>1)type='checkbox-group';
    let title = label(el);
    if (type === 'radio'||type==='checkbox-group') {
      const legend = el.closest('fieldset')?.querySelector('legend')?.textContent;
      title = normalized(legend || (el.closest('[role=radiogroup],[role=group]')?label(el.closest('[role=radiogroup],[role=group]')):'') || el.name || title).slice(0, 100);
    }
    const options = type === 'select' ? [...el.options].filter(option => option.value !== '' && !option.disabled && !option.closest('optgroup[disabled]')).map((option, i) => ({value: 'choice_' + i, label: normalized(option.label).slice(0, 100), actual: option.value, node: option})) : (type === 'radio'||type==='checkbox-group') ? refs.map((radio, i) => ({value: 'choice_' + i, label: label(radio), actual: radio.value??radio.getAttribute('data-value')??label(radio), node: radio})) : null;
    return {el, refs, type, label: title, name: el.getAttribute('name') || '', id: el.id || '', form: el.form||el.closest('form'), step:location.href, path: path(el), required: refs.some(ref => ref.required||ref.getAttribute('aria-required')==='true'), options};
  }
  function reason(f, requireEmpty = true) {
    if(f.type!=='select'&&f.el.closest('[role=combobox]'))return 'Custom dropdown needs a verified adapter; it is not delegated as free text';
    if (!allowed.has(f.type)) return 'Unsupported input type: ' + f.type;
    if (f.form?.querySelector('input[type=password]')) return 'Authentication form containing a password field';
    if (f.type === 'select' && f.el.multiple) return 'Multiple-select controls are not supported';
    for (const el of f.refs) {
      if(!native(el)&&(!['div','span'].includes(el.localName)||!el.hasAttribute('tabindex')||el.tabIndex < -1||!['true','false'].includes(el.getAttribute('aria-checked'))||el.closest('button,a,[role=button],[role=link]')||el.querySelector('input,textarea,select,[contenteditable=true]')))return 'Custom control lacks a safe accessible read/activate contract';
      if(!native(el)&&el.getAttribute('role')==='radio'&&!el.closest('[role=radiogroup]'))return 'Custom radio needs an accessible radiogroup';
      const context = [f.label, label(el), el.name, el.id, el.autocomplete, f.form?.getAttribute('id'), f.form?.getAttribute('name'), f.form?.getAttribute('action')].map(normalized).join(' ');
      if (sensitive.test(context) || /^(?:username|current-password|new-password|one-time-code|cc-)/i.test(el.autocomplete || '')) return 'Sensitive or authentication-related field';
      if (el.disabled || el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled')==='true'||el.getAttribute('aria-readonly')==='true') return 'Disabled or read-only';
      if (!el.isConnected || el.getClientRects().length === 0 || ![...el.getClientRects()].some(rect=>rect.width>0&&rect.height>0) || getComputedStyle(el).visibility !== 'visible' || el.closest('[hidden],[inert],[contenteditable=true]')) return 'Hidden, detached, or non-editable';
    }
    if (f.options && (!f.options.length || f.options.length > 50 || f.options.some(option => !option.label))) return 'Requires 1-50 labelled, enabled choices';
    if (f.options && ((f.type!=='checkbox-group'&&new Set(f.options.map(o => o.actual)).size !== f.options.length) || new Set(f.options.map(o => o.label)).size !== f.options.length)) return 'Ambiguous choice labels or values; review manually';
    if (requireEmpty && (f.type === 'checkbox' ? checked(f.el) : (f.type === 'radio'||f.type==='checkbox-group') ? f.refs.some(checked) : f.el.value.trim() !== '')) return 'Already contains an answer';
    return '';
  }
  function definition(f) {
    return {key: f.key, label: f.label, type: f.type, ...((f.type === 'checkbox'||f.type==='checkbox-group') ? {required: f.required} : {}), ...(f.options ? {options: f.options.map(({value, label}) => ({value, label}))} : {})};
  }
  function sameChoices(a, b, actual = true) {
    return JSON.stringify((a.options || []).map(o => [o.label, ...(actual ? [o.actual] : [])])) === JSON.stringify((b.options || []).map(o => [o.label, ...(actual ? [o.actual] : [])]));
  }
  function mapping(f, requireEmpty = true) {
    if (!f.el || !f.refs.length || f.refs.some(el => !el.isConnected)) return 'Page replaced the selected control; confirm its replacement';
    const now = describe(f.el);
    if (now.type !== f.type || now.label !== f.label || now.name !== f.name || now.id !== f.id || now.form !== f.form || now.step !== f.step || now.required !== f.required || !sameChoices(f, now) || now.refs.length !== f.refs.length || now.refs.some((el, i) => el !== f.refs[i])) return 'Field identity or choices changed; confirm the mapping';
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
  function refresh() {
    if (selecting) for (const el of [...document.querySelectorAll(controls)].slice(0, 1000)) {
      if (chosenFor(el)) paint(el, 'selected');
      else if (!reason(describe(el))) paint(el, 'supported');
      else restore(el);
    }
    for (const el of [...decorations.keys()]) if (!el.isConnected && !chosenFor(el)) decorations.delete(el);
    update();
  }
  function watch() {
    if (observer) return;
    observer = new MutationObserver(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(()=>{
      if(location.href!==initialURL){initialURL=location.href;status('Page step changed. Mappings are revalidated before filling; replaced fields need confirmation.')}
      if(selecting)refresh();else if(tracker?.answers&&!filling){const deferred=chosen.filter(f=>f.state==='deferred'&&!mapping(f));if(deferred.length)apply(tracker.answers,deferred)}
    }, 120); });
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'name', 'type', 'disabled', 'readonly', 'hidden', 'class', 'multiple', 'required', 'autocomplete', 'aria-label', 'aria-labelledby','aria-checked','aria-disabled','aria-readonly']});
  }
  function publicState() {
    const results = chosen.map(f=>({key:f.key,label:f.label,type:f.type,state:f.state,detail:f.detail||'',needsConfirmation:f.state==='confirmation'}));
    const phase = !tracker ? null : tracker.phase || (!tracker.done ? 'waiting' : filling ? 'received' : chosen.every(f=>f.state==='verified') ? 'completed' : 'partial');
    return {version:VERSION,origin:location.origin,documentToken,selecting,creating,busy:filling>0,status:stateMessage,selection:tracker?[]:chosen.map(definition),request:tracker?{id:tracker.id,base:tracker.base,sourcePath:tracker.sourcePath||location.pathname,url:tracker.url||tracker.base+'/r/'+tracker.id,expiresAt:tracker.expiresAt,phase,fields:chosen.map(definition),results}:null};
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
    if(!selecting&&!confirmationKey&&(!tracker||['expired','unauthorized'].includes(tracker.phase)||tracker.done&&chosen.every(f=>['verified','failed','skipped','undone'].includes(f.state)))){observer?.disconnect();observer=null;clearTimeout(refreshTimer)}
  }
  function reset() {
    if(filling||creating||tracker&&!tracker.done&&(!tracker.expiresAt||tracker.expiresAt>Date.now()))throw Error('A request is active. Wait for its response or expiry before starting a new one.');
    stop();clearInterval(timer);tracker=null;chosen=[];previous.clear();for(const el of [...decorations.keys()])restore(el);idleObserver();status('Selection cleared. Start selection to create a new request.');
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
      return f.refs.some(el => preChecked.get(el)) ? 'Already contains an answer' : '';
    }
    return reason(f);
  }
  function keyguard(event) { if (event.key === 'Enter') block(event); if (event.key === ' ') remember(event); }
  function target(event) {
    if (!(event.target instanceof Element)) return null;
    const direct = event.target.closest(controls);
    return direct || event.target.closest('label')?.control || null;
  }
  function stop() {
    selecting = false; confirmationKey = null;
    document.removeEventListener('click', pick, true);
    document.removeEventListener('pointerdown', remember, true);
    if (!filling) document.removeEventListener('submit', block, true);
    document.removeEventListener('mouseover',hover,true);document.removeEventListener('mouseout',unhover,true);
    document.removeEventListener('keydown', keyguard, true);
    for (const el of [...decorations.keys()]) if (!chosenFor(el)||chosenFor(el).state==='selected') restore(el);
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
    if (tracker && !tracker.done) throw Error('Wait for the current request before selecting again');
    stop(); tracker=null; for (const el of [...decorations.keys()]) restore(el);
    chosen = []; previous.clear(); selecting = true; activate(); refresh();status('Selection mode active. Click supported unanswered fields.');
  }
  function pick(event) {
    const button = event.target instanceof Element && event.target.closest('button,input[type=submit],input[type=image]');
    if (button && (!(button instanceof HTMLButtonElement) || button.type !== 'button')) { block(event); return; }
    const el = target(event); if (!el) return;
    const f = describe(el); block(event);
    if (confirmationKey) {
      const item = chosen.find(item => item.key === confirmationKey);
      if (!item || selectionReason(f) || f.type !== item.type || f.label !== item.label || f.required !== item.required || !sameChoices(f, item, false) || chosen.some(other => other !== item && other.refs.some(ref => f.refs.includes(ref)))) { status('Replacement is incompatible, sensitive, already filled, or selected elsewhere. Choose the matching unanswered control.'); return; }
      for (const ref of item.refs) restore(ref);
      Object.assign(item, f, {state: 'selected', detail: 'Mapping confirmed by clicking the replacement'});
      stop(); item.refs.forEach(ref => paint(ref, 'selected')); update();
      if (tracker?.answers) setTimeout(() => apply(tracker.answers, [item]), 0);
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
      if (seen.has(el)) continue;
      const f = describe(el); f.refs.forEach(ref => seen.add(ref));
      const selected = chosenFor(el);
      all.push({label: f.label, type: f.type, location: (f.form?.getAttribute('id') || f.form?.getAttribute('name') || 'page') + ' / ' + f.path, supported: !reason(f), reason: reason(f), selected: !!selected});
    }
    for(const el of [...document.querySelectorAll('[role=combobox],[role=listbox],[role=textbox],[contenteditable=true]')].slice(0,100)){if(!el.matches(controls))all.push({label:label(el),type:'custom '+(el.getAttribute('role')||'rich text'),location:path(el),supported:false,reason:'Custom widget needs a verified value adapter',selected:false})}
    const pending = chosen.map(f => ({key: f.key, label: f.label, state: f.state, detail: f.detail || mapping(f), needsConfirmation: f.state === 'confirmation' || (f.state === 'selected' && !!mapping(f))}));
    return {fields: all, selected: pending, busy: filling > 0, duplicates: all.filter((f, i) => all.some((other, j) => i !== j && f.label === other.label)).length, frames: document.querySelectorAll('iframe,frame').length, custom: [...document.querySelectorAll('[role=combobox],[role=listbox],[role=textbox],[role=checkbox],[role=radio]')].filter(el=>!native(el)&&!el.matches('[role=checkbox][aria-checked],[role=radio][aria-checked]')).length, truncated: candidates.length > 1000, limitations: 'Native controls in this document only. Iframes, shadow DOM, custom dropdowns, multiple-select and trusted-event-only widgets are unsupported. Accessible div/span checkboxes and radios are checked individually.'};
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
  function values(f) { return f.refs.map(el => f.type === 'radio' || f.type === 'checkbox' || f.type === 'checkbox-group' ? checked(el) : el.value); }
  function expected(f, answer) {
    if (f.type === 'checkbox') return typeof answer === 'boolean' && (!f.required || answer) ? [answer] : null;
    if(f.type==='checkbox-group')return Array.isArray(answer)&&new Set(answer).size===answer.length&&answer.every(value=>f.options.some(o=>o.value===value))&&(!f.required||answer.length)?f.options.map(o=>answer.includes(o.value)):null;
    if (f.type === 'radio') return typeof answer === 'string' && f.options.some(o => o.value === answer) ? f.options.map(o => o.value === answer) : null;
    if (f.type === 'select') { const option = f.options.find(o => o.value === answer); return option ? [option.actual] : null; }
    return typeof answer === 'string' && answer.length <= 500 ? [answer] : null;
  }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  async function apply(answers, items = chosen) {
    if (!answers || typeof answers !== 'object') return;
    // Block normal submit events throughout framework processing. Never call
    // submit/requestSubmit or synthesize an activating button/MouseEvent click.
    filling++;if(tracker)tracker.phase='received';publish();
    document.addEventListener('submit', block, true);
    const attempted = [];
    try {
      for (const f of items) {
        if (f.state === 'verified' || f.state === 'applying' || !Object.hasOwn(answers, f.key)) continue;
        const issue = mapping(f);
        if (issue) { f.state = /confirm|replaced/.test(issue) ? 'confirmation' : /Hidden/.test(issue) ? 'deferred' : 'skipped'; f.detail = issue; f.refs.filter(el => el.isConnected).forEach(el => paint(el, 'pending')); continue; }
        const wanted = expected(f, answers[f.key]);
        if (!wanted) { f.state = 'failed'; f.detail = 'Response did not match the selected type or choices'; continue; }
        const before = values(f); f.state = 'applying'; f.detail = 'Waiting for page processing';
        f.refs.forEach((el, i) => setNative(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group' ? 'checked' : 'value', wanted[i]));
        const invalid = f.refs.some(el => (el.validity&&!el.validity.valid) || (el.maxLength >= 0 && el.value.length > el.maxLength) || (el.minLength > 0 && el.value.length < el.minLength));
        if (invalid) { f.refs.forEach((el, i) => setNative(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group' ? 'checked' : 'value', before[i])); f.state = 'failed'; f.detail = 'Answer violates the original field constraints'; f.refs.forEach(el => paint(el, 'failed')); continue; }
        for (const el of f.refs) events(el, f.type === 'checkbox' || f.type==='checkbox-group' || (f.type === 'radio' && checked(el)));
        attempted.push({f, before, wanted});
      }
      // Check twice: synchronous success alone misses controlled-input reverts.
      if (attempted.length) await delay(150);
      for (const attempt of attempted) attempt.first = attempt.f.refs.every(el => el.isConnected) && equal(values(attempt.f), attempt.wanted);
      if (attempted.length) await delay(500);
      if(!alive)return;
      for (const {f, before, wanted, first} of attempted) {
        if (first && f.refs.every(el => el.isConnected) && equal(values(f), wanted) && !mapping(f, false) && f.refs.every(el => !el.validity||el.validity.valid)) {
          f.state = 'verified'; f.detail = 'Value retained after input/change events and two delayed checks'; previous.set(f.key, {f, before, wanted}); f.refs.forEach(el => paint(el, 'verified'));
        } else { f.state = f.refs.some(el => !el.isConnected) || /confirm/.test(mapping(f, false)) ? 'confirmation' : 'failed'; f.detail = f.state === 'confirmation' ? 'Page replaced this control while processing; confirm replacement' : 'The page rejected or changed the value; review manually'; f.refs.filter(el => el.isConnected).forEach(el => paint(el, 'failed')); }
      }
      if(tracker)tracker.phase=chosen.every(f=>f.state==='verified')?'completed':'partial';
      status(chosen.filter(f => f.state === 'verified').length + '/' + chosen.length + ' fields verified. Review values; open Check compatibility for skipped fields or mapping confirmation.');
    } finally { filling--;idleObserver();publish(); if (!filling && !selecting && !confirmationKey) document.removeEventListener('submit', block, true); }
  }
  async function poll() {
    const active=tracker;
    if(!active||active.done||active.polling||!alive)return;
    if(active.expiresAt&&Date.now()>=active.expiresAt){active.done=true;active.phase='expired';clearInterval(timer);idleObserver();status('Request expired. Start a new request.');return}
    active.polling=true;
    try {
      const response=await runtimeCall({action:'FETCH',base:active.base,path:'/api/requests/'+active.id+'/status',token:active.token});
      if(!alive||tracker!==active||active.done)return;
      if(!response.ok){
        if(response.status===404||response.status===403){active.done=true;active.phase=response.status===404?'expired':'unauthorized';clearInterval(timer);idleObserver();status(response.status===404?'Request expired or backend restarted. Create a new request.':'Response access denied. Start a new request from the original tab.');return}
        active.phase='offline';status(response.error||'Backend unavailable. Retrying automatically; check your server.');return;
      }
      if(response.data?.submitted){active.done=true;active.phase='received';active.answers=response.data.answers;clearInterval(timer);status('Response received. Verifying inserted values.');await apply(active.answers)}
      else if(active.phase!=='waiting'){active.phase='waiting';status('Connected. Waiting for the recipient.');}
    }catch(error){if(alive&&tracker===active)status('Connection interrupted. Retrying automatically. '+error.message)}finally{active.polling=false}
  }
  function undo() {
    document.addEventListener('submit', block, true);
    try {
      for (const {f, before, wanted} of previous.values()) {
        if (f.refs.some(el => !el.isConnected) || !equal(values(f), wanted)) continue; // Preserve later user edits.
        if(f.type==='radio'&&f.refs.some(el=>!native(el))&&before.every(value=>!value)){f.state='undo-unavailable';f.detail='Custom radios cannot safely clear an entire answered group. Review manually.';continue}
        f.refs.forEach((el, i) => { setNative(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group' ? 'checked' : 'value', before[i]); events(el, f.type === 'checkbox' || f.type === 'radio' || f.type === 'checkbox-group'); restore(el); });
        f.state = 'undone'; f.detail = 'Restored; review the original page';
      }
      previous.clear();
    } finally { if (!selecting && !confirmationKey) document.removeEventListener('submit', block, true); }
  }
  const listener=(msg,sender,reply)=>{
    (async()=>{
      if(msg.action==='PING'){reply({ok:true,version:VERSION,documentToken});return}
      await ready;
      if(msg.documentToken&&msg.documentToken!==documentToken)throw Error('The page changed during request creation. Reopen FormRelay to confirm mappings.');
      if(msg.action==='GET_STATE'){if(!tracker&&!creating&&!chosen.length)await recoverContext();reply({...publicState(),ok:true});return}
      if(msg.action==='GET_SELECTION'){reply({fields:chosen.map(definition),issues:chosen.filter(f=>f.state!=='verified'&&mapping(f)).map(f=>({key:f.key,label:f.label,detail:mapping(f)}))});return}
      if(msg.action==='CHECK'){reply(compatibility());return}
      if(msg.action==='PREPARE_REQUEST'){
        if(creating||filling||tracker&&!tracker.done)throw Error('A request is already in progress.');
        if(!chosen.length||chosen.some(f=>mapping(f)))throw Error('Select unanswered fields and resolve changed mappings first.');
        stop();creating=true;status('Creating a secure request.');reply({ok:true,documentToken,fields:chosen.map(definition),contextFields:chosen.map(f=>({...definition(f),required:f.required}))});return;
      }
      if(msg.action==='CREATE_FAILED'){creating=false;status('Request creation failed. Check Settings and retry.');reply({ok:true});return}
      if(msg.action==='START'){start();reply({ok:true});return}
      if(msg.action==='STOP'){stop();status('Selection finished. Review your selected questions.');reply({ok:true});return}
      if(msg.action==='CLEAR'||msg.action==='NEW_REQUEST'){reset();reply({ok:true});return}
      if(msg.action==='REMOVE_FIELD'){
        if(creating||filling||tracker)throw Error('Request mappings are locked until this request is finished.');
        const f=chosen.find(f=>f.key===msg.key);if(f){f.refs.forEach(restore);chosen=chosen.filter(item=>item!==f);status(f.label+' removed.');refresh()}reply({ok:true});return;
      }
      if(msg.action==='CONFIRM_MAPPING'){
        if(filling||creating)throw Error('Wait for page processing before confirming another mapping');
        const item=chosen.find(f=>f.key===msg.key);if(!item)throw Error('Selected field not found');
        stop();confirmationKey=item.key;activate();status('Click the matching unanswered replacement for '+item.label);reply({ok:true});return;
      }
      if(msg.action==='TRACK'){
        if(filling||tracker&&!tracker.done)throw Error('A request is already pending');
        stop();creating=false;tracker={...msg.track,done:false,phase:'waiting'};clearInterval(timer);watch();status('Request ready. Waiting for the recipient.');poll();timer=setInterval(poll,2500);reply({ok:true});return;
      }
      if(msg.action==='UNDO'){if(filling)throw Error('Wait for page processing before undo');undo();status('Restored unchanged filled controls where possible. Review the page.');reply({ok:true});return}
      throw Error('Unknown content operation');
    })().catch(error=>reply({ok:false,error:error.message}));return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.__formrelayInstance={version:VERSION,alive:true,dispose};
  window.addEventListener('pagehide',dispose,{once:true});
  async function recoverContext(){const response=await runtimeCall({action:'INIT',documentToken});
    if(response.request){
      const r=response.request;tracker={...r,done:false,phase:'waiting'};
      chosen=r.fields.map(f=>({...f,required:!!f.required,refs:[],el:null,state:'confirmation',detail:'Page navigation or extension update: click to confirm this mapping'}));
      status('Active request restored. Confirm mappings before answers can be inserted.');watch();poll();timer=setInterval(poll,2500);
    }else if(response.notice)status(response.notice);
    publish();

  }
  ready=recoverContext().catch(()=>{});
})();
