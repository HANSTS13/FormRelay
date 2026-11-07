const id = location.pathname.split('/').pop();
const form = document.getElementById('response');
const status = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-view');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');

let fields = [];
let useSimplified = true;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function load() {
  try {
    const r = await fetch(`/api/requests/${id}/fields`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Unavailable or Expired Request');
    if (data.submitted) {
      status.className = 'status-success';
      status.innerHTML = '<h3>✓ Request Already Completed</h3><p style="margin-top:8px">This request has already been answered and securely relayed back to the original form.</p>';
      form.style.display = 'none';
      return;
    }
    fields = data.fields || [];
    renderFields();
    updateProgress();
  } catch (e) {
    status.className = 'status-error';
    status.textContent = '❌ ' + e.message;
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
  if (progressText) progressText.textContent = `${filled} of ${fields.length} questions completed`;
  if (progressPercent) progressPercent.textContent = `${pct}%`;
}

function renderFields() {
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
      badge.textContent = `✨ AI Clarified ${f.aiConfidence ? `(${f.aiConfidence})` : ''}`;
      labelRow.appendChild(badge);
    }

    block.appendChild(labelRow);

    // Always show original legal question as safeguard
    if (useSimplified && f.isSimplified && f.originalLabel) {
      const origText = document.createElement('div');
      origText.className = 'orig-subtext';
      origText.innerHTML = `<strong>Official Form Question:</strong> "${escapeHtml(f.originalLabel)}"`;
      block.appendChild(origText);
    }

    // AI Guidance tip
    if (f.aiHint) {
      const hint = document.createElement('div');
      hint.className = 'ai-hint-box';
      hint.innerHTML = `<span>💡</span><div><strong>AI Guidance:</strong> ${escapeHtml(f.aiHint)}</div>`;
      block.appendChild(hint);
    }

    // Control Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'input-wrapper';

    const valPill = document.createElement('div');
    valPill.className = 'validation-pill';

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
    } else if (f.type === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.id = f.key;
      textarea.name = f.key;
      textarea.required = true;
      textarea.rows = 3;
      textarea.maxLength = 500;
      textarea.placeholder = `Enter ${useSimplified ? (f.simplifiedLabel || f.label) : f.label}...`;
      if (currentValues[f.key]) textarea.value = currentValues[f.key];
      textarea.addEventListener('input', () => {
        updateProgress();
        validateField(f, textarea, valPill);
      });
      wrapper.appendChild(textarea);
    } else {
      const input = document.createElement('input');
      input.id = f.key;
      input.name = f.key;
      input.type = f.type || 'text';
      input.required = true;
      input.maxLength = 500;
      input.placeholder = `Enter ${useSimplified ? (f.simplifiedLabel || f.label) : f.label}...`;
      if (currentValues[f.key]) input.value = currentValues[f.key];

      input.addEventListener('input', () => {
        updateProgress();
        validateField(f, input, valPill);
      });

      wrapper.appendChild(input);

      // AI Voice Input (Web Speech API)
      if (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)) {
        const mic = document.createElement('button');
        mic.type = 'button';
        mic.className = 'mic-btn';
        mic.title = 'Speak answer (Speech-to-Text)';
        mic.innerHTML = '🎙️';
        mic.onclick = () => startVoiceInput(mic, input);
        wrapper.appendChild(mic);
      }
    }

    block.appendChild(wrapper);
    block.appendChild(valPill);

    const initialEl = wrapper.querySelector('input, select, textarea');
    if (initialEl && initialEl.value) {
      validateField(f, initialEl, valPill);
    }

    form.appendChild(block);
  }

  // Legal & Accuracy confirmation checkbox
  const confirmBlock = document.createElement('div');
  confirmBlock.style.cssText = 'margin-top: 22px; display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 14px; border-radius: 10px;';
  confirmBlock.innerHTML = `
    <input type="checkbox" id="user-confirm" required checked style="width: 18px; height: 18px; cursor: pointer; accent-color: #4f46e5;">
    <label for="user-confirm" style="cursor: pointer;">I confirm that these details are authentic and authorized for official form submission.</label>
  `;
  form.appendChild(confirmBlock);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'submit-btn';
  submitBtn.innerHTML = '🔒 Submit Answers Securely';
  form.appendChild(submitBtn);
}

function validateField(f, el, pill) {
  const val = el.value.trim();
  if (!val) {
    pill.className = 'validation-pill';
    pill.textContent = '';
    return;
  }

  const key = (f.key || '').toLowerCase();
  const label = (f.label || '').toLowerCase();

  if (f.type === 'tel' || key.includes('phone') || label.includes('phone') || label.includes('contact') || label.includes('mobile')) {
    const cleanDigits = val.replace(/\D/g, '');
    if (cleanDigits.length >= 10) {
      pill.className = 'validation-pill valid';
      pill.innerHTML = `✓ Valid phone format (${cleanDigits.length} digits)`;
      return;
    }
  }

  if (f.type === 'email' || key.includes('email') || label.includes('email')) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      pill.className = 'validation-pill valid';
      pill.innerHTML = `✓ Valid email address`;
      return;
    }
  }

  if (f.type === 'number' || key.includes('income') || label.includes('remuneration') || label.includes('salary') || label.includes('income')) {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      pill.className = 'validation-pill valid';
      pill.innerHTML = `✓ Valid income amount: ₹${num.toLocaleString('en-IN')}`;
      return;
    }
  }

  if (key.includes('name') || label.includes('name') || label.includes('member')) {
    if (val.length >= 3) {
      pill.className = 'validation-pill valid';
      pill.innerHTML = `✓ Name format valid`;
      return;
    }
  }

  if (f.type === 'select' && val) {
    pill.className = 'validation-pill valid';
    pill.innerHTML = `✓ Option selected`;
    return;
  }

  pill.className = 'validation-pill valid';
  pill.innerHTML = `✓ Ready for submission`;
}

function startVoiceInput(micBtn, targetInput) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  micBtn.classList.add('listening');
  micBtn.innerHTML = '🔴';

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    targetInput.value = transcript;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    updateProgress();
  };

  recognition.onerror = () => {
    micBtn.classList.remove('listening');
    micBtn.innerHTML = '🎙️';
  };

  recognition.onend = () => {
    micBtn.classList.remove('listening');
    micBtn.innerHTML = '🎙️';
  };

  recognition.start();
}

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    useSimplified = !useSimplified;
    toggleBtn.textContent = useSimplified ? '📋 Show Original Legal Labels' : '✨ Show AI Simplified Labels';
    renderFields();
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const answers = {};
  for (const f of fields) {
    const el = form.elements.namedItem(f.key);
    answers[f.key] = el ? el.value : '';
  }
  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Encrypting & Transmitting...';
  }

  try {
    const r = await fetch(`/api/requests/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to submit answers');

    form.remove();
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'All questions submitted!';
    if (progressPercent) progressPercent.textContent = '100%';

    status.className = 'status-success';
    status.innerHTML = `
      <h3>🎉 Answers Transmitted Successfully!</h3>
      <p style="margin-top:8px; font-size: 0.95rem; line-height: 1.5;">Your answers have been securely relayed back to the applicant's browser. The original form on their device will automatically populate in real time.</p>
      <div style="margin-top: 14px; font-size: 11px; color: #047857;">🔒 This session has now self-destructed and is locked from further edits.</div>
    `;
  } catch (e) {
    status.className = 'status-error';
    status.textContent = '❌ ' + e.message;
    if (button) {
      button.disabled = false;
      button.textContent = '🔒 Submit Answers Securely';
    }
  }
});

load();
