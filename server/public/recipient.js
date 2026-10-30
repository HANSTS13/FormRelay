const id = location.pathname.split('/').pop();
const form = document.getElementById('response');
const status = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-view');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');

let fields = [];
let useSimplified = true;

async function load() {
  try {
    const r = await fetch(`/api/requests/${id}/fields`);
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Unavailable');
    if (data.submitted) {
      status.className = 'status-success';
      status.innerHTML = '<h3>âœ“ Request Completed</h3><p style="margin-top:8px">This request has already been answered and relayed back to the original form.</p>';
      form.style.display = 'none';
      return;
    }
    fields = data.fields;
    renderFields();
    updateProgress();
  } catch (e) {
    status.className = 'status-error';
    status.textContent = e.message;
  }
}

function updateProgress() {
  if (!fields.length) return;
  let filled = 0;
  for (const f of fields) {
    const el = form.elements.namedItem(f.key);
    if (el && el.value && el.value.trim().length > 0) {
      filled++;
    }
  }
  const pct = Math.round((filled / fields.length) * 100);
  if (progressBar) progressBar.style.width = pct + '%';
  if (progressText) progressText.textContent = `${filled} of ${fields.length} fields completed`;
  if (progressPercent) progressPercent.textContent = `${pct}%`;
}

function renderFields() {
  // Preserve any currently typed values before re-rendering
  const currentValues = {};
  for (const f of fields) {
    const el = form.elements?.namedItem?.(f.key);
    if (el) currentValues[f.key] = el.value;
  }

  form.innerHTML = '';

  for (const f of fields) {
    const block = document.createElement('div');
    block.className = 'field-block';

    const labelRow = document.createElement('div');
    labelRow.className = 'field-label-row';

    const questionTitle = document.createElement('label');
    questionTitle.className = 'question-title';
    questionTitle.htmlFor = f.key;
    questionTitle.textContent = useSimplified ? (f.simplifiedLabel || f.label) : (f.originalLabel || f.label);

    labelRow.appendChild(questionTitle);

    if (useSimplified && f.isSimplified) {
      const badge = document.createElement('span');
      badge.className = 'ai-tag';
      badge.textContent = 'Local rule suggestion';
      labelRow.appendChild(badge);
    }

    block.appendChild(labelRow);

    // Safeguard: Always show original official wording
    if (useSimplified && f.isSimplified && f.originalLabel) {
      const origText = document.createElement('div');
      origText.className = 'orig-subtext';
      origText.innerHTML = `<strong>Official Form Question:</strong> "${escapeHtml(f.originalLabel)}"`;
      block.appendChild(origText);
    }

    // AI Contextual Guidance Tip (Specific & Actionable)
    if (f.aiHint) {
      const hint = document.createElement('div');
      hint.className = 'ai-hint-box';
      hint.innerHTML = `<span>ðŸ’¡</span><div><strong>AI Guidance:</strong> ${escapeHtml(f.aiHint)}</div>`;
      block.appendChild(hint);
    }

    // Control Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'input-wrapper';

    if (f.type === 'select') {
      const select = document.createElement('select');
      select.id = f.key;
      select.name = f.key;
      select.required = true;

      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = `-- Select ${(useSimplified ? f.simplifiedLabel : f.label) || 'Option'} --`;
      select.appendChild(defOpt);

      if (Array.isArray(f.options)) {
        for (const opt of f.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label || opt.value;
          select.appendChild(o);
        }
      }
      if (currentValues[f.key]) select.value = currentValues[f.key];
      select.addEventListener('change', () => {
        updateProgress();
        validateField(f, select, valPill);
      });
      wrapper.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.id = f.key;
      input.name = f.key;
      input.type = f.type;
      input.required = true;
      input.maxLength = 500;
      input.placeholder = `Enter ${useSimplified ? (f.simplifiedLabel || f.label) : f.label}...`;
      if (currentValues[f.key]) input.value = currentValues[f.key];

      input.addEventListener('input', () => {
        updateProgress();
        validateField(f, input, valPill);
      });

      wrapper.appendChild(input);

      // AI Voice Input (Speech-to-Text) Support
      if (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)) {
        const mic = document.createElement('button');
        mic.type = 'button';
        mic.className = 'mic-btn';
        mic.title = 'Speak answer (AI Voice Assistant)';
        mic.innerHTML = 'ðŸŽ™ï¸';
        mic.onclick = () => {if(window.confirm('Your browser may send microphone audio to an online speech service. Use fictional data only. Continue?'))startVoiceInput(mic, input)};
        wrapper.appendChild(mic);
      }
    }

    block.appendChild(wrapper);

    // Live AI Validation Pill
    const valPill = document.createElement('div');
    valPill.className = 'validation-pill';
    block.appendChild(valPill);

    // Run initial validation if prefilled
    const initialEl = wrapper.querySelector('input, select');
    if (initialEl && initialEl.value) {
      validateField(f, initialEl, valPill);
    }

    form.appendChild(block);
  }

  // Legal & Accuracy confirmation
  const confirmBlock = document.createElement('div');
  confirmBlock.className = 'confirm-row';
  confirmBlock.innerHTML = `
    <input type="checkbox" id="user-confirm" required checked>
    <label for="user-confirm">I verify that the above information is accurate for the student's official application.</label>
  `;
  form.appendChild(confirmBlock);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'submit-btn';
  submitBtn.textContent = 'Submit Answers Securely';
  form.appendChild(submitBtn);
}

function validateField(f, el, pill) {
  const value=el.value.trim();
  if(!value){pill.className='validation-pill';pill.textContent='';return;}
  const valid=el.checkValidity() && (f.type!=='tel'||/^[+()0-9 .-]{3,40}$/.test(value));
  pill.className='validation-pill valid';
  pill.textContent=valid?'Format checks passed. Review for accuracy.':'Review this answer’s format before sending.';
}
function startVoiceInput(micBtn, targetInput) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  micBtn.classList.add('listening');
  micBtn.innerHTML = 'ðŸ”´';

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    targetInput.value = transcript;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    updateProgress();
  };

  recognition.onerror = () => {
    micBtn.classList.remove('listening');
    micBtn.innerHTML = 'ðŸŽ™ï¸';
  };

  recognition.onend = () => {
    micBtn.classList.remove('listening');
    micBtn.innerHTML = 'ðŸŽ™ï¸';
  };

  recognition.start();
}

// Toggle View Button
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    useSimplified = !useSimplified;
    toggleBtn.textContent = useSimplified ? 'ðŸ”„ Show Original Legal Labels' : 'âœ¨ Show AI Simplified Labels';
    renderFields();
  });
}

// Form Submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const answers = {};
  for (const f of fields) {
    answers[f.key] = form.elements.namedItem(f.key).value;
  }
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const r = await fetch(`/api/requests/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Failed to submit answers');

    form.remove();
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'All fields submitted!';
    if (progressPercent) progressPercent.textContent = '100%';

    status.className = 'status-success';
    status.innerHTML = `
      <h3>âœ“ Successfully Submitted!</h3>
      <p style="margin-top:6px; font-size: 0.95rem;">Your answers have been securely transferred. The student's original form will automatically populate in real time.</p>
    `;
  } catch (e) {
    status.className = 'status-error';
    status.textContent = e.message;
    if (button) button.disabled = false;
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

load();
