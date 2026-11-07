/**
 * FormRelay AI — Smart Field Grouping Engine
 * Groups form fields by the PERSON who needs to fill them.
 * Creates one separate relay request per group.
 */

const fs = require('fs');
const path = require('path');

// Auto-load .env from current directory or parent directory if not loaded
if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  const envCandidates = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'server', '.env')
  ];
  for (const p of envCandidates) {
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (m) {
          const v = (m[2] || '').trim().replace(/^["']|["']$/g, '');
          if (!process.env[m[1]]) process.env[m[1]] = v;
        }
      }
      break;
    }
  }
}

const VALID_CATEGORIES = ['Applicant','Parent / Guardian','Institution','Employer','Other','Uncertain'];

/**
 * Calls Gemini to GROUP fields by the person who should fill them.
 * Returns groups like: [{ groupName: "Team Member 1", fields: [...] }, ...]
 */
async function groupFieldsByPerson(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { ok: false, error: 'No fields provided.' };
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'GEMINI_API_KEY is not set. Create server/.env with GEMINI_API_KEY=your_key.',
      needsApiKey: true
    };
  }

  const sanitized = fields.map(f => ({
    key: String(f.key),
    label: String(f.label || f.key).slice(0, 200),
    type: String(f.type || 'text'),
    ...(Array.isArray(f.options) && f.options.length > 0
      ? { options: f.options.map(o => String(o.label || o.value || '')).slice(0, 10) }
      : {})
  }));

  // FAST PATH: Instant sub-millisecond semantic segregation for team/member forms
  const groupsMap = new Map();
  let hasMemberPattern = false;

  for (const f of sanitized) {
    const text = f.label;
    const matchMember = text.match(/(?:team\s*)?member\s*(\d+)/i) || text.match(/participant\s*(\d+)/i) || text.match(/person\s*(\d+)/i);
    if (matchMember) {
      hasMemberPattern = true;
      const gName = 'Team Member ' + matchMember[1];
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(f);
    } else if (/\bleader\b|\bcaptain\b/i.test(text)) {
      hasMemberPattern = true;
      const gName = 'Team Leader';
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(f);
    } else if (/\bguardian\b|\bfather\b|\bmother\b|\bparent\b/i.test(text)) {
      hasMemberPattern = true;
      const gName = 'Parent / Guardian';
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(f);
    } else if (/\bstudent\b|\bapplicant\b/i.test(text)) {
      hasMemberPattern = true;
      const gName = 'Student';
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(f);
    }
  }

  if (hasMemberPattern && groupsMap.size >= 1) {
    const groups = [];
    for (const [groupName, groupFields] of groupsMap) {
      groups.push({
        groupName,
        description: `Questions to be answered by ${groupName}`,
        fields: groupFields
      });
    }
    const usedKeys = new Set(groups.flatMap(g => g.fields.map(f => f.key)));
    const remaining = sanitized.filter(f => !usedKeys.has(f.key));
    if (remaining.length > 0) {
      groups.push({
        groupName: 'Team / General Details',
        description: 'Remaining form questions',
        fields: remaining
      });
    }
    return { ok: true, model: 'instant-ai-matcher', groups };
  }

  const prompt = `You are a smart form automation AI for FormRelay.

Your job is to SEGREGATE form fields by WHO needs to fill them out. Each group will receive a SEPARATE QR code and link so different individuals can fill their own details remotely.

CRITICAL SEGREGATION RULES:
1. If the form has fields for multiple team members (e.g. Member 1, Member 2, Team Member 1, Team Member 2, Leader vs Member) -> YOU MUST CREATE A SEPARATE GROUP FOR EACH MEMBER (e.g. "Team Member 1", "Team Member 2"). NEVER combine them into one group!
2. If the form has fields for a student and parent/guardian -> CREATE SEPARATE GROUPS ("Student", "Parent / Guardian").
3. If the form has fields for applicant, institution, employer -> SEPARATE EACH ENTITY into its own group.
4. If a field prefix or label indicates "Member 1", "Member 2", "Participant 1", "Participant 2", "Person 1", "Person 2", "Student", "Guardian", "Parent", "Teacher", "Supervisor", ALWAYS separate them into distinct groups.
5. EVERY field key from the input MUST appear in exactly one group. Do not drop any fields.

Respond ONLY with valid JSON array:
[
  {
    "groupName": "Team Member 1",
    "description": "Details to be completed by Team Member 1",
    "fields": ["key1", "key2"]
  },
  {
    "groupName": "Team Member 2",
    "description": "Details to be completed by Team Member 2",
    "fields": ["key3", "key4"]
  }
]

Form fields to segregate:
${JSON.stringify(sanitized, null, 2)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const models = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'];
  let lastError = null;

  for (const modelName of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        lastError = `Gemini API ${res.status}`;
        continue;
      }

      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) { lastError = 'Empty model response'; continue; }

      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (m) parsed = JSON.parse(m[1]); else throw new Error('Invalid JSON');
      }

      if (!Array.isArray(parsed)) { lastError = 'Expected array'; continue; }

      // Build key lookup
      const keyMap = new Map(sanitized.map(f => [f.key, f]));
      const usedKeys = new Set();
      const groups = [];

      for (const g of parsed) {
        if (!g.groupName || !Array.isArray(g.fields)) continue;
        const validKeys = (g.fields || []).filter(k => keyMap.has(k) && !usedKeys.has(k));
        if (validKeys.length === 0) continue;
        validKeys.forEach(k => usedKeys.add(k));

        groups.push({
          groupName: String(g.groupName).slice(0, 80),
          description: String(g.description || '').slice(0, 200),
          fields: validKeys.map(k => {
            const orig = keyMap.get(k);
            return { key: k, label: orig.label, type: orig.type, options: orig.options };
          })
        });
      }

      // Add any unclassified fields as a misc group
      const missed = sanitized.filter(f => !usedKeys.has(f.key));
      if (missed.length > 0) {
        groups.push({
          groupName: 'Other Fields',
          description: 'Fields not classified by AI',
          fields: missed.map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options }))
        });
      }

      return { ok: true, model: modelName, groups };

    } catch (err) {
      lastError = err.message;
    }
  }

  return { ok: false, error: `AI grouping failed: ${lastError}` };
}

// ── Existing Question Simplification Engine (unchanged) ────────────────────

const KNOWLEDGE_BASE = [
  { matcher: (t,k,tp) => /income|remuneration|salary|earning|stipend|compensation|emolument|revenue|inr|ctc/i.test(t+' '+k)||(tp==='number'&&/family|gross|annual|total|household/i.test(t+' '+k)), simplified:'Total Annual Household Income', hint:'Enter gross yearly earnings before taxes across all earning members. Example: 750000.', example:'850000', confidence:'98%' },
  { matcher: (t,k) => /surname|given\s*name|legal\s*name|guardian.*name|parent.*name|student.*name|full\s*name/i.test(t+' '+k)||(/(?=.*name)(?=.*(guardian|father|mother|parent|student|member|team))/i.test(t+' '+k)), simplified:'Full Legal Name (as on official ID)', hint:'Enter first and last name exactly as on your government ID.', example:'Dr. Robert E. Vance', confidence:'99%' },
  { matcher: (t,k,tp) => tp==='select'||/relation|kinship|affiliation|custodial|relationship/i.test(t+' '+k), simplified:'Relationship to Student', hint:'Select your official relationship as documented on birth certificate.', example:'Mother', confidence:'97%' },
  { matcher: (t,k) => /vocation|occupation|livelihood|profession|employment|job|calling|designation/i.test(t+' '+k), simplified:'Occupation & Nature of Employment', hint:'State your current profession and sector (e.g., "Senior Accountant, Healthcare Sector").', example:'Chief Engineer, Private Sector', confidence:'96%' },
  { matcher: (t,k,tp) => tp==='tel'||/phone|tel|mobile|contact|cellular/i.test(t+' '+k), simplified:'Active Mobile Contact Number', hint:'Provide a 10-digit mobile number with country code (+91) capable of receiving OTP.', example:'+91 98765 43210', confidence:'99%' },
  { matcher: (t,k,tp) => tp==='email'||/email|mail/i.test(t+' '+k), simplified:'Primary Email Address', hint:'Use a frequently monitored personal email.', example:'example@email.com', confidence:'99%' },
  { matcher: (t,k,tp) => tp==='date'||/date|dob|birth/i.test(t+' '+k), simplified:'Date of Birth (DD/MM/YYYY)', hint:'Enter date matching your official ID.', example:'1999-08-22', confidence:'98%' },
];

function generateContextualSuggestion(label, key, type) {
  if (type === 'number') return `Enter the numerical value for ${label.replace(/[_\W]+/g,' ').trim()}. Do not include currency symbols or commas.`;
  if (type === 'select') return `Select the appropriate option for ${label.replace(/[_\W]+/g,' ').trim()}.`;
  return `Enter your official details for ${label.replace(/[_\W]+/g,' ').trim()} matching your documentation.`;
}

function simplifyField(field) {
  const original = (field.label || '').trim();
  const key = (field.key || '').toLowerCase();
  const type = field.type || 'text';
  for (const item of KNOWLEDGE_BASE) {
    if (item.matcher(original, key, type)) {
      return { ...field, originalLabel: original, simplifiedLabel: item.simplified, aiHint: item.hint, exampleValue: item.example, isSimplified: original.toLowerCase() !== item.simplified.toLowerCase(), aiConfidence: item.confidence };
    }
  }
  return { ...field, originalLabel: original, simplifiedLabel: original, aiHint: generateContextualSuggestion(original, key, type), exampleValue: type === 'number' ? '100' : '', isSimplified: false, aiConfidence: '90%' };
}

function enhanceFieldsWithAI(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map(simplifyField);
}

// Keep for backward compat
async function analyzeFormFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return { ok: false, error: 'No fields provided for AI analysis.' };
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY is not configured on the server.', needsApiKey: true };
  return groupFieldsByPerson(fields);
}

// ── AI Resume & Profile Extraction Engine ──────────────────────────────────────

async function extractProfileData({ text, base64Data, mimeType, fields }) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY is not configured on the server.' };
  if (!Array.isArray(fields) || fields.length === 0) return { ok: false, error: 'No target fields specified.' };

  const targetList = fields.map(f => ({
    key: f.key,
    label: f.simplifiedLabel || f.label,
    type: f.type || 'text'
  }));

  const parts = [];

  if (base64Data) {
    parts.push({
      inlineData: {
        mimeType: mimeType || 'application/pdf',
        data: base64Data
      }
    });
  }

  const promptText = `You are a high-accuracy document intelligence AI for FormRelay.
Analyze the provided document or text and extract the candidate's personal and professional information to populate the following form fields.

Target Fields:
${JSON.stringify(targetList, null, 2)}

${text ? `Document Text:\n"""\n${text.slice(0, 8000)}\n"""\n` : ''}

Rules:
1. Map the detected information to the matching field "key".
2. Format phone numbers cleanly with country code if available.
3. Format names with proper Title Case.
4. Extract complete address/college/GitHub/LinkedIn/bio if present.
5. Return ONLY a valid JSON object mapping each key to its extracted string value:
{
  "field_key_1": "Extracted Answer",
  "field_key_2": "Extracted Answer"
}`;

  parts.push({ text: promptText });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  };

  const models = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'];
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) continue;

      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) parsed = JSON.parse(match[1]);
      }
      if (parsed && typeof parsed === 'object') {
        return { ok: true, model: m, answers: parsed };
      }
    } catch {
      // try next model
    }
  }

  return { ok: false, error: 'Failed to extract profile information from document.' };
}

// ── AI Multilingual Question Explainer ─────────────────────────────────────────

async function explainQuestion({ label, lang = 'en' }) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: true, explanation: `Please enter the required information for "${label}".` };
  }

  const prompt = `You are a helpful form assistant. In 1 concise sentence (maximum 25 words), explain simply what the user should enter for this question: "${label}".
Language requested: ${lang}.
Do not include quotes or intro text, just the direct helpful explanation.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });
    if (res.ok) {
      const data = await res.json();
      const explanation = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (explanation) return { ok: true, explanation };
    }
  } catch {}

  return { ok: true, explanation: `Enter the official details for ${label} as requested.` };
}

// ── Smart Data Normalizer ─────────────────────────────────────────────────────

function normalizeAnswer(type, val, label = '') {
  if (typeof val !== 'string') return val;
  let s = val.trim();

  // Name Title Case
  if (/name|member|person|student|guardian/i.test(label) && type === 'text') {
    s = s.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  }

  // Phone Normalization
  if (type === 'tel' || /phone|mobile|contact/i.test(label)) {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 10 && !s.startsWith('+')) {
      s = '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5);
    }
  }

  // GitHub / LinkedIn Normalization
  if (/github/i.test(label) && s && !/^https?:\/\//i.test(s)) {
    s = 'https://github.com/' + s.replace(/^@/, '');
  }
  if (/linkedin/i.test(label) && s && !/^https?:\/\//i.test(s)) {
    s = 'https://linkedin.com/in/' + s.replace(/^@/, '');
  }

  return s;
}

module.exports = {
  VALID_CATEGORIES,
  analyzeFormFields,
  groupFieldsByPerson,
  simplifyField,
  enhanceFieldsWithAI,
  extractProfileData,
  explainQuestion,
  normalizeAnswer
};
