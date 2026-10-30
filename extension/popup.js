/* popup.js — FormRelay  (AI Smart Field Grouping edition) */
'use strict';

const $ = id => document.getElementById(id);
const base = $('base');

let scannedFields = [];   // from SCAN_FIELDS
let aiGroups      = [];   // from /api/ai/group-fields

// ── Restore saved state ───────────────────────────────────────────────────────
chrome.storage.local.get(['formrelayBase', 'formrelaySelected', 'formrelayStatus'], d => {
  if (d.formrelayBase) base.value = d.formrelayBase;
  showSelected(d.formrelaySelected || []);
  if (d.formrelayStatus) $('message').textContent = d.formrelayStatus;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showSelected(fields) {
  $('fields').textContent = fields.length
    ? fields.map(f => `✓ ${f.label}`).join('\n')
    : 'No fields selected yet';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function serverOrigin() {
  try { return new URL(base.value).origin; }
  catch { return 'http://localhost:3000'; }
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t?.id) throw new Error('Please open a form page first.');
  return t;
}

async function sendToContent(action, extra = {}) {
  const t = await activeTab();
  try {
    return await chrome.tabs.sendMessage(t.id, { action, ...extra });
  } catch (_) {
    // Content script not yet injected — inject it then retry
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(t.id, { action, ...extra });
  }
}

function setMsg(text, color = '#0284c7') {
  const el = $('message');
  el.textContent = text;
  el.style.color  = color;
}

// ── AI Smart Group Flow ───────────────────────────────────────────────────────

$('btn-ai-group').onclick = async () => {
  try {
    setMsg('Scanning form fields on this page…');
    const res = await sendToContent('SCAN_FIELDS');

    if (!res || !res.ok || !res.fields || res.fields.length === 0) {
      setMsg('No supported form fields found on this page. Navigate to a form first.', '#dc2626');
      return;
    }

    scannedFields = res.fields;
    $('ai-scan-summary').textContent =
      `Found ${scannedFields.length} form field${scannedFields.length !== 1 ? 's' : ''}. ` +
      `AI will group them by who should fill them in and generate a separate QR for each group.`;

    // Show approval panel
    $('ai-panel').style.display     = 'block';
    $('ai-approval').style.display  = 'block';
    $('ai-loading').style.display   = 'none';
    $('ai-results').style.display   = 'none';
    setMsg('');
  } catch (e) {
    setMsg(`Error: ${e.message}`, '#dc2626');
  }
};

$('ai-close').onclick  = () => { $('ai-panel').style.display = 'none'; };
$('ai-cancel').onclick = () => { $('ai-panel').style.display = 'none'; };

$('btn-skip-ai').onclick = () => {
  $('ai-panel').style.display = 'none';
  setMsg('Manual mode — click "1. Manual Select" to pick fields.');
};

// Step 2 — call AI
$('ai-confirm').onclick = async () => {
  $('ai-approval').style.display = 'none';
  $('ai-loading').style.display  = 'block';
  $('ai-results').style.display  = 'none';

  try {
    const origin = serverOrigin();
    const resp = await fetch(`${origin}/api/ai/group-fields`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: scannedFields })
    });

    const data = await resp.json().catch(() => ({ ok: false, error: 'Invalid server response' }));

    $('ai-loading').style.display = 'none';

    if (!data.ok) {
      $('ai-approval').style.display = 'block';
      const hint = data.needsApiKey
        ? ' (Set GEMINI_API_KEY in server/.env)'
        : '';
      setMsg(`AI Error: ${data.error}${hint}`, '#dc2626');
      return;
    }

    aiGroups = data.groups || [];

    if (aiGroups.length === 0) {
      $('ai-approval').style.display = 'block';
      setMsg('AI returned no groups. Try manual selection.', '#b45309');
      return;
    }

    renderGroupCards(aiGroups, origin);
    $('ai-results').style.display = 'block';
    setMsg(`AI identified ${aiGroups.length} group${aiGroups.length !== 1 ? 's' : ''}. Create a QR for each one below.`, '#059669');

  } catch (e) {
    $('ai-loading').style.display  = 'none';
    $('ai-approval').style.display = 'block';
    setMsg(`Network error: ${e.message}`, '#dc2626');
  }
};

// ── Render Group Cards ────────────────────────────────────────────────────────
function renderGroupCards(groups, origin) {
  const container = $('group-cards-container');
  container.innerHTML = '';

  groups.forEach((g, idx) => {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div class="group-header">
        <span class="group-name">👥 ${escapeHtml(g.groupName)}</span>
      </div>
      <div class="group-desc">${escapeHtml(g.description || '')}</div>
      <div class="group-fields-list">
        ${(g.fields || []).map(f =>
          `<div class="group-field-item">
             • ${escapeHtml(f.label)}
             <span class="field-type-tag">${escapeHtml(f.type || 'text')}</span>
           </div>`
        ).join('')}
      </div>
      <button class="btn-create-group" id="btn-grp-${idx}" type="button">
        📤 Create QR for ${escapeHtml(g.groupName)}
      </button>
      <img  class="qr-mini"   id="qr-group-${idx}"     alt="QR" style="display:none">
      <a    class="group-link" id="link-group-${idx}"   target="_blank"></a>
      <div class="group-status" id="status-group-${idx}"></div>
    `;
    container.appendChild(card);

    // Attach per-card handler
    document.getElementById(`btn-grp-${idx}`).onclick = () => createQrForGroup(idx, g, origin);
  });
}

async function createQrForGroup(idx, group, origin) {
  const btn    = $(`btn-grp-${idx}`);
  const qrImg  = $(`qr-group-${idx}`);
  const linkEl = $(`link-group-${idx}`);
  const status = $(`status-group-${idx}`);

  btn.disabled    = true;
  btn.textContent = '⏳ Creating…';

  try {
    // 1. Apply selection to the tab (highlights fields green, stores in storage)
    const keys = (group.fields || []).map(f => f.key);
    const selResult = await sendToContent('SET_SELECTION', { keys });
    if (!selResult?.ok) throw new Error('Could not apply field selection on the page.');

    // 2. Read back what was stored
    const stored = await chrome.storage.local.get('formrelaySelected');
    const selectedFields = stored.formrelaySelected || [];
    showSelected(selectedFields);

    // 3. POST to /api/requests
    chrome.storage.local.set({ formrelayBase: origin });
    const r = await fetch(`${origin}/api/requests`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: selectedFields })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Server error ${r.status}`);

    // 4. Track on the form tab
    await sendToContent('TRACK', { track: { base: origin, id: data.id, token: data.ownerToken } });

    // 5. Show QR + link on this card
    qrImg.src           = `${origin}/api/requests/${data.id}/qr.png`;
    qrImg.style.display = 'block';
    linkEl.href         = data.url;
    linkEl.textContent  = data.url;
    status.textContent  = `✅ QR ready for ${group.groupName}! Keep this tab open.`;
    btn.textContent     = '✓ QR Created';
    btn.style.background = '#059669';

    setMsg(`QR created for "${group.groupName}". Share the link or scan the QR.`, '#059669');
  } catch (e) {
    btn.disabled    = false;
    btn.textContent = `📤 Create QR for ${group.groupName}`;
    status.textContent = `❌ ${e.message}`;
    setMsg(e.message, '#dc2626');
  }
}

// ── Manual Selection Flow (unchanged) ────────────────────────────────────────

$('select').onclick = async () => {
  try {
    await sendToContent('START');
    setMsg('Selection active — close this popup and click the fields you want to delegate.');
  } catch (e) {
    setMsg(e.message, '#dc2626');
  }
};

$('finish').onclick = async () => {
  try {
    await sendToContent('STOP');
    const d = await chrome.storage.local.get('formrelaySelected');
    showSelected(d.formrelaySelected || []);
    setMsg('Selection finished. Create a QR/Link below.');
  } catch (e) {
    setMsg(e.message, '#dc2626');
  }
};

$('create').onclick = async () => {
  try {
    const origin = serverOrigin();
    const validOrigins = ['http://localhost:3000'];
    const isRender = origin.startsWith('https://') &&
                     new URL(origin).hostname.endsWith('.onrender.com');
    if (!validOrigins.includes(origin) && !isRender) {
      throw new Error('Backend must be http://localhost:3000 or an HTTPS onrender.com URL.');
    }

    const d = await chrome.storage.local.get('formrelaySelected');
    if (!d.formrelaySelected?.length) throw new Error('Select fields first.');

    chrome.storage.local.set({ formrelayBase: origin });

    const r = await fetch(`${origin}/api/requests`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: d.formrelaySelected })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Server error ${r.status}`);

    await sendToContent('TRACK', { track: { base: origin, id: data.id, token: data.ownerToken } });

    $('qr').src          = `${origin}/api/requests/${data.id}/qr.png`;
    $('qr').style.display = 'block';
    $('link').href        = data.url;
    $('link').textContent = data.url;
    setMsg('Request ready! Keep this tab open to receive the autofill.');
  } catch (e) {
    setMsg(e.message, '#dc2626');
  }
};

$('undo').onclick = async () => {
  try {
    await sendToContent('UNDO');
    setMsg('Original form values restored.');
  } catch (e) {
    setMsg(e.message, '#dc2626');
  }
};
