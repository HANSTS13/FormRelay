const id = location.pathname.split('/').pop();
const form = document.getElementById('response');
const status = document.getElementById('status');
let fields = [];
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
    form.appendChild(group); return;
  }
  const label = document.createElement('label'); label.appendChild(document.createTextNode(f.label));
  let el;
  if (f.type === 'select') {
    el = document.createElement('select'); el.name = f.key; el.required = true;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an answer'; el.appendChild(placeholder);
    for (const option of f.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; el.appendChild(node); }
  } else if (f.type === 'textarea') { el = document.createElement('textarea'); el.name = f.key; el.required = true; el.maxLength = 500; }
  else el = input(f);
  label.appendChild(el); form.appendChild(label);
}
async function load() {
  try {
    const response = await fetch('/api/requests/' + id + '/fields'); const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unavailable');
    if (data.submitted) { status.textContent = 'This request is already completed.'; return; }
    fields = data.fields; fields.forEach(render);
    const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Send answers'; form.appendChild(button);
  } catch (error) { status.textContent = error.message; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const answers = Object.create(null);
  for (const f of fields) { const el = form.elements.namedItem(f.key); answers[f.key] = f.type==='checkbox-group' ? [...form.querySelectorAll('input[name="'+CSS.escape(f.key)+'"]:checked')].map(input=>input.value) : f.type === 'checkbox' ? el.checked : el.value; }
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/requests/' + id + '/answer', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({answers})});
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'Failed');
    form.remove(); status.textContent = 'Submitted! The requester can now review automatic filling in the original form.';
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
load();
