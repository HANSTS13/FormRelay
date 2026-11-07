const id = location.pathname.split('/').pop();
const form = document.getElementById('response');
const status = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-view');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');

let fields = [];
let useSimplified = true;
let progressTimeout = null;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Live Progress Beacon ───────────────────────────────────────────────────────

function reportProgress(state = 'active') {
  if (!fields.length) return;
  clearTimeout(progressTimeout);
  progressTimeout = setTimeout(() => {
    let filled = 0;
    for (const f of fields) {
      const el = form.elements.namedItem(f.key);
      if (el && el.value && el.value.trim().length > 0) filled++;
    }
    fetch(`/api/requests/${id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: state,
        filledCount: filled,
        totalCount: fields.length
      })
    }).catch(() => {});
  }, 400);
}

// ── Load Fields ───────────────────────────────────────────────────────────────

async function load() {
  try {
    const r = await fetch(`/api/requests/${id}/fields`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Unavailable or Expired Request');
    if (data.submitted) {
      status.className = 'status-success';
      status.innerHTML = '<h3>✓ Request Already Completed</h3><p style="margin-top:8px">This request has already been answered and securely relayed back to the original form.</p>';
      form.style.display = 'none';
      const aiCard = document.getElementById('ai-autofill-card');
      if (aiCard) aiCard.style.display = 'none';
      return;
    }
    fields = data.fields || [];
    renderFields();
    updateProgress();
    initDropzone();
    reportProgress('opened');
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
  reportProgress(filled === fields.length ? 'all_answered' : 'typing');
}

// ── Render Fields with Audio & AI Explainer ────────────────────────────────────

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

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

    const questionTitle = document.createElement('label');
    questionTitle.className = 'question-title';
    questionTitle.htmlFor = f.key;
    const activeLabel = useSimplified ? (f.simplifiedLabel || f.label) : (f.originalLabel || f.label);
    questionTitle.textContent = activeLabel;
    titleWrap.appendChild(questionTitle);

    if (useSimplified && f.isSimplified) {
      const badge = document.createElement('span');
      badge.className = 'ai-tag';
      badge.textContent = `✨ AI Clarified`;
      titleWrap.appendChild(badge);
    }
    labelRow.appendChild(titleWrap);

    // Audio & Explainer Buttons
    const toolsWrap = document.createElement('div');
    toolsWrap.className = 'field-actions';

    // 🔊 Listen
    if ('speechSynthesis' in window) {
      const listenBtn = document.createElement('button');
      listenBtn.type = 'button';
      listenBtn.className = 'btn-field-tool';
      listenBtn.title = 'Listen to question';
      listenBtn.innerHTML = '🔊 Read';
      listenBtn.onclick = () => {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(activeLabel);
        utter.rate = 0.95;
        window.speechSynthesis.speak(utter);
      };
      toolsWrap.appendChild(listenBtn);
    }

    // 💡 AI Explain
    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'btn-field-tool';
    explainBtn.title = 'AI Question Guidance';
    explainBtn.innerHTML = '💡 Explain';
    toolsWrap.appendChild(explainBtn);

    labelRow.appendChild(toolsWrap);
    block.appendChild(labelRow);

    // Explain Bubble Container (Hidden by default)
    const explainBox = document.createElement('div');
    explainBox.className = 'explain-bubble';
    explainBox.style.display = 'none';
    block.appendChild(explainBox);

    explainBtn.onclick = async () => {
      if (explainBox.style.display === 'flex') {
        explainBox.style.display = 'none';
        return;
      }
      explainBox.style.display = 'flex';
      explainBox.innerHTML = '<span>⏳</span><span>AI is generating helpful guidance...</span>';
      try {
        const resp = await fetch('/api/ai/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: activeLabel })
        });
        const d = await resp.json();
        explainBox.innerHTML = `<span>💡</span><div>${escapeHtml(d.explanation || f.aiHint || 'Provide official details.')}</div>`;
      } catch {
        explainBox.innerHTML = `<span>💡</span><div>${escapeHtml(f.aiHint || 'Enter your official information for this question.')}</div>`;
      }
    };

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

// ── Dropzone & Document AI Extraction ──────────────────────────────────────────

function initDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('resume-file');
  const pasteBtn = document.getElementById('btn-paste-bio');
  const pasteContainer = document.getElementById('paste-box-container');
  const cancelPaste = document.getElementById('btn-cancel-paste');
  const submitPaste = document.getElementById('btn-submit-paste');
  const pasteInput = document.getElementById('paste-bio-input');
  const promptView = document.getElementById('dropzone-prompt');
  const statusView = document.getElementById('upload-status');
  const statusText = document.getElementById('upload-status-text');

  if (!dropzone || !fileInput) return;

  dropzone.onclick = (e) => {
    if (e.target.id === 'btn-paste-bio' || e.target.closest('#btn-paste-bio')) return;
    fileInput.click();
  };

  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); };
  dropzone.ondragleave = () => dropzone.classList.remove('drag-over');
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) handleFile(e.dataTransfer.files[0]);
  };

  fileInput.onchange = () => {
    if (fileInput.files?.length) handleFile(fileInput.files[0]);
  };

  if (pasteBtn && pasteContainer) {
    pasteBtn.onclick = (e) => {
      e.stopPropagation();
      pasteContainer.style.display = 'block';
      pasteInput.focus();
    };
  }
  if (cancelPaste && pasteContainer) {
    cancelPaste.onclick = () => { pasteContainer.style.display = 'none'; };
  }
  if (submitPaste && pasteInput) {
    submitPaste.onclick = async () => {
      const text = pasteInput.value.trim();
      if (!text) return;
      pasteContainer.style.display = 'none';
      await runExtraction({ text });
    };
  }

  function handleFile(file) {
    const isText = file.type.startsWith('text/') || file.name.endsWith('.txt');
    if (isText) {
      const reader = new FileReader();
      reader.onload = async () => { await runExtraction({ text: reader.result }); };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = String(reader.result).split(',')[1];
        await runExtraction({ base64Data, mimeType: file.type || 'application/pdf' });
      };
      reader.readAsDataURL(file);
    }
  }

  async function runExtraction(payload) {
    if (promptView) promptView.style.display = 'none';
    if (statusView) statusView.style.display = 'flex';
    if (statusText) statusText.textContent = '⚡ Gemini AI reading document & extracting fields...';

    try {
      const res = await fetch('/api/ai/extract-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, fields })
      });
      const data = await res.json();
      if (!data.ok || !data.answers) throw new Error(data.error || 'No matching details extracted.');

      let filledCount = 0;
      for (const [k, v] of Object.entries(data.answers)) {
        if (!v) continue;
        const el = form.elements.namedItem(k);
        if (el) {
          el.value = String(v).trim();
          el.classList.add('field-sparkle');
          setTimeout(() => el.classList.remove('field-sparkle'), 1500);
          filledCount++;
        }
      }

      updateProgress();
      if (statusText) statusText.innerHTML = `✓ AI successfully populated <strong>${filledCount}</strong> fields!`;
      setTimeout(() => {
        if (statusView) statusView.style.display = 'none';
        if (promptView) promptView.style.display = 'flex';
      }, 3500);
    } catch (err) {
      if (statusText) statusText.textContent = '⚠️ ' + err.message;
      setTimeout(() => {
        if (statusView) statusView.style.display = 'none';
        if (promptView) promptView.style.display = 'flex';
      }, 3000);
    }
  }
}

// ── Smart Validation & Live Feedback ──────────────────────────────────────────

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
      pill.innerHTML = `✓ Valid numeric format: ₹${num.toLocaleString('en-IN')}`;
      return;
    }
  }

  if (key.includes('name') || label.includes('name') || label.includes('member')) {
    if (val.length >= 3) {
      pill.className = 'validation-pill valid';
      pill.innerHTML = `✓ Valid name`;
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

// ── Speech-to-Text Input ──────────────────────────────────────────────────────

function startVoiceInput(button, input) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  const recognition = new SpeechRec();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  button.classList.add('listening');
  button.innerHTML = '🔴 Listening...';

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    input.value = transcript;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  recognition.onspeechend = () => {
    button.classList.remove('listening');
    button.innerHTML = '🎙️';
    recognition.stop();
  };

  recognition.onerror = () => {
    button.classList.remove('listening');
    button.innerHTML = '🎙️';
  };

  recognition.start();
}

// ── Submit Handling ───────────────────────────────────────────────────────────

form.onsubmit = async (e) => {
  e.preventDefault();
  const btn = form.querySelector('.submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Encrypting &amp; Relaying Answers...';
  }

  const answers = {};
  for (const f of fields) {
    const el = form.elements[f.key];
    answers[f.key] = el ? el.value.trim() : '';
  }

  try {
    const r = await fetch(`/api/requests/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || 'Submission failed');

    status.className = 'status-success';
    status.innerHTML = `
      <h3>✓ Answers Relayed Successfully!</h3>
      <p style="margin-top: 6px; font-size: 0.95rem;">Your answers have been securely injected into the primary registration form in real time.</p>
      <div style="margin-top: 14px; font-size: 0.8rem; color: #047857; font-weight: 600;">🔒 Session is now locked and protected. You may close this tab.</div>
    `;
    form.style.display = 'none';
    const aiCard = document.getElementById('ai-autofill-card');
    if (aiCard) aiCard.style.display = 'none';
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔒 Submit Answers Securely';
    }
    status.className = 'status-error';
    status.textContent = '❌ Submission error: ' + err.message;
  }
};

// ── Toggle Legal View ─────────────────────────────────────────────────────────

if (toggleBtn) {
  toggleBtn.onclick = () => {
    useSimplified = !useSimplified;
    toggleBtn.textContent = useSimplified ? '📋 Show Original Legal Labels' : '✨ Show AI-Clarified Labels';
    renderFields();
    updateProgress();
  };
}

load();
