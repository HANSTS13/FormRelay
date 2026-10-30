const id = location.pathname.split('/').pop();
const form = document.getElementById('response');
const status = document.getElementById('status');
let fields = [];
const otherInputs=new Map();
const fieldNodes=new Map();
const assistance=document.createElement('section');assistance.id='ai-assistance';assistance.setAttribute('aria-label','AI Assistance');
const heading=document.createElement('h2');heading.textContent='AI Assistance';
const explanation=document.createElement('p');explanation.textContent='Local rule-based guidance. Always review the original question; these tips do not verify your answers.';
const toggle=document.createElement('button');toggle.type='button';toggle.id='toggle-guidance';toggle.textContent='Hide guidance';toggle.setAttribute('aria-expanded','true');
const progress=document.createElement('progress');progress.id='answer-progress';progress.setAttribute('aria-label','Completed questions');
const progressText=document.createElement('p');progressText.id='progress-text';progressText.setAttribute('role','status');
assistance.append(heading,explanation,toggle,progress,progressText);form.before(assistance);
toggle.addEventListener('click',()=>{const visible=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(visible));toggle.textContent=visible?'Hide guidance':'Show guidance';document.querySelectorAll('.assistance-hint').forEach(node=>node.hidden=!visible)});
function complete(f){
  const inputs=[...form.querySelectorAll('[name="'+CSS.escape(f.key)+'"]')];let valid;
  if(f.type==='checkbox')valid=!f.required||inputs[0]?.checked;
  else if(f.type==='checkbox-group')valid=!f.required||inputs.some(el=>el.checked);
  else if(f.type==='radio')valid=inputs.some(el=>el.checked);
  else{const el=inputs[0];valid=!!el?.value.trim()&&el.checkValidity()&&(f.type!=='tel'||/^[+()0-9 .-]{3,40}$/.test(el.value));}
  return !!valid&&[...(otherInputs.get(f.key)||[])].every(([,el])=>el.disabled||!!el.value.trim()&&el.checkValidity());
}
function updateAssistance(){
  const count=fields.filter(complete).length;progress.max=fields.length||1;progress.value=count;progressText.textContent=count+' of '+fields.length+' questions complete';
  for(const f of fields){const node=fieldNodes.get(f.key)?.querySelector('.format-feedback');if(node)node.textContent=complete(f)?'Format checks passed. Review the answer for accuracy.':'Complete this question using the requested format.';}
}
let recognition=null;
function voice(el,button){
  if(recognition){status.textContent='Finish the current voice recording first.';return}
  const API=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!API||!window.confirm('Your browser may send microphone audio to an online speech service. Use fictional data only. Continue?'))return;
  const finish=()=>{recognition=null;button.disabled=false;button.textContent='Speak answer'};
  try{
    recognition=new API();recognition.lang=document.documentElement.lang||'en';recognition.interimResults=false;recognition.maxAlternatives=1;button.disabled=true;button.textContent='Listening…';
    recognition.onresult=event=>{const text=event.results?.[0]?.[0]?.transcript;if(typeof text!=='string'||text.length>500){status.textContent='Voice answer is too long or unavailable. Type your answer instead.';return}el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));status.textContent='Voice text inserted. Review it before sending.'};
    recognition.onerror=()=>{status.textContent='Voice input unavailable or permission denied. Type your answer instead.';finish()};recognition.onend=finish;recognition.start();
  }catch{status.textContent='Voice input could not start. Type your answer instead.';finish()}
}
function decorate(f,container){
  fieldNodes.set(f.key,container);
  const hint=document.createElement('div');hint.className='assistance-hint';hint.hidden=toggle.getAttribute('aria-expanded')!=='true';
  if(f.isSimplified){const simple=document.createElement('p');simple.textContent='Plain-language suggestion: '+f.simplifiedLabel;hint.appendChild(simple)}
  const tip=document.createElement('p');tip.textContent=f.aiHint||'Answer the original question.';hint.appendChild(tip);container.appendChild(hint);
  const feedback=document.createElement('p');feedback.className='format-feedback';container.appendChild(feedback);
  const el=container.querySelector('input:not([type=checkbox]):not([type=radio]),textarea');
  if(el&&['text','email','tel','textarea'].includes(f.type)&&(window.SpeechRecognition||window.webkitSpeechRecognition)){const button=document.createElement('button');button.type='button';button.textContent='Speak answer';const questionLabel=container.querySelector('label,legend');if(questionLabel){questionLabel.id='question-label-'+f.key;button.setAttribute('aria-describedby',questionLabel.id)}button.title='Speak answer for '+f.label;button.onclick=()=>voice(el,button);container.appendChild(button)}
}
form.addEventListener('input',updateAssistance);form.addEventListener('change',updateAssistance);
window.addEventListener('pagehide',()=>{try{recognition?.abort()}catch{}},{once:true});
function addOtherInputs(f,container){
  const inputs=new Map();otherInputs.set(f.key,inputs);
  for(const option of f.options||[]){if(!option.other)continue;const label=document.createElement('label');label.textContent='Specify '+option.label+' — '+f.label;const el=document.createElement('input');el.type='text';el.maxLength=500;label.appendChild(el);container.appendChild(label);inputs.set(option.value,el);}
  const update=()=>{const control=form.elements.namedItem(f.key);const selected=f.type==='checkbox-group'?[...form.querySelectorAll('input[name="'+CSS.escape(f.key)+'"]:checked')].map(el=>el.value):[control?.value];for(const [value,el] of inputs){const active=selected.includes(value);el.parentElement.hidden=!active;el.disabled=!active;el.required=active;}};
  container.addEventListener('change',update);update();
}
function input(f, type = f.type) {
  const el = document.createElement('input');
  el.type = type; el.name = f.key; el.required = type !== 'checkbox' || f.required;
  if (!['checkbox', 'radio'].includes(type)) el.maxLength = 500;
  return el;
}
function render(f) {
  if (f.type === 'radio'||f.type==='checkbox-group') {
    const group = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = f.label; group.appendChild(legend);
    for (const option of f.options) {
      const label = document.createElement('label'); const el = input(f, f.type==='checkbox-group'?'checkbox':'radio'); if(f.type==='checkbox-group')el.required=false;el.value = option.value;
      label.append(el, document.createTextNode(option.label)); group.appendChild(label);
    }
    if(f.type==='checkbox-group'&&f.required){const validate=()=>group.querySelector('input').setCustomValidity(group.querySelector('input:checked')?'':'Choose at least one option');group.addEventListener('input',validate);validate()}
    form.appendChild(group);addOtherInputs(f,group);decorate(f,group);return;
  }
  const label = document.createElement('label'); label.appendChild(document.createTextNode(f.label));
  let el;
  if (f.type === 'select') {
    el = document.createElement('select'); el.name = f.key; el.required = true;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an answer'; el.appendChild(placeholder);
    for (const option of f.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; el.appendChild(node); }
  } else if (f.type === 'textarea') { el = document.createElement('textarea'); el.name = f.key; el.required = true; el.maxLength = 500; }
  else el = input(f);
  el.setAttribute('aria-label',f.label);label.appendChild(el);const container=document.createElement('div');container.appendChild(label);form.appendChild(container);addOtherInputs(f,container);decorate(f,container);
}
async function load() {
  try {
    const response = await fetch('/api/requests/' + id + '/fields'); const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unavailable');
    if (data.submitted) { status.textContent = 'This request is already completed.'; return; }
    fields = data.fields; fields.forEach(render);
    const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Send answers'; form.appendChild(button);
    updateAssistance();
  } catch (error) { status.textContent = error.message; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const answers = Object.create(null);
  for (const f of fields) { const el = form.elements.namedItem(f.key);const value=f.type==='checkbox-group' ? [...form.querySelectorAll('input[name="'+CSS.escape(f.key)+'"]:checked')].map(input=>input.value) : f.type === 'checkbox' ? el.checked : el.value;const selected=Array.isArray(value)?value:[value];const custom=Object.fromEntries([...(otherInputs.get(f.key)||[])].filter(([id])=>selected.includes(id)).map(([id,el])=>[id,el.value]));answers[f.key]=Object.keys(custom).length?{value,other:custom}:value; }
  const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const response = await fetch('/api/requests/' + id + '/answer', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({answers})});
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'Failed');
    try{recognition?.abort()}catch{}form.remove();assistance.remove();status.textContent = 'Submitted! The requester can now review automatic filling in the original form.';
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
load();
