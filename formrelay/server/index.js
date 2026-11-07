const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const {
  enhanceFieldsWithAI,
  groupFieldsByPerson,
  extractProfileData,
  explainQuestion,
  normalizeAnswer
} = require('./ai');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) {
      const v = (m[2] || '').trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

const app = express();
app.disable('x-powered-by');

// ── SECURITY MIDDLEWARE ───────────────────────────────────────────────────────

// 1. Strict Payload Limit (10mb to allow PDF/Resume base64 parsing)
app.use(express.json({ limit: '10mb', strict: true }));

// 2. Comprehensive Security Headers & Content Security Policy (CSP)
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self), payment=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';"
  });

  // CORS Policy: Allow localhost, chrome extensions, and explicit HTTPS domains
  const origin = req.get('Origin');
  if (origin) {
    const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isExtension = /^chrome-extension:\/\/[a-z]{32}$/.test(origin);
    const isRender = /^https:\/\/[a-zA-Z0-9-]+\.onrender\.com$/.test(origin);

    if (isLocal || isExtension || isRender) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-FormRelay-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 3. In-Memory Sliding-Window Rate Limiter
function createRateLimiter(windowMs, maxRequests, message) {
  const hits = new Map();
  // Cleanup old records periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of hits.entries()) {
      if (now - record.resetTime > windowMs) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip) || { count: 0, resetTime: now };

    if (now - record.resetTime > windowMs) {
      record.count = 1;
      record.resetTime = now;
    } else {
      record.count++;
    }
    hits.set(ip, record);

    if (record.count > maxRequests) {
      return res.status(429).json({ ok: false, error: message || 'Too many requests. Please slow down.' });
    }
    next();
  };
}

const aiLimiter = createRateLimiter(60_000, 30, 'AI request limit reached. Please wait a minute.');
const createLimiter = createRateLimiter(60_000, 45, 'Request creation limit exceeded. Please wait.');
const answerLimiter = createRateLimiter(60_000, 60, 'Too many submission attempts.');

// ── SENSITIVE DATA DEFENSE ────────────────────────────────────────────────────
const SENSITIVE_PATTERN = /password|passcode|one[\s_-]*time|otp|verification[\s_-]*code|security[\s_-]*code|\bauth\b|cvv|cvc|credit[\s_-]*card|debit[\s_-]*card|pin[\s_-]*code|\bpin\b|\bssn\b|\baadhaar\b/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function sanitizeText(val) {
  if (typeof val !== 'string') return '';
  return val.replace(/[<>]/g, '').trim().slice(0, 1000);
}

// ── IN-MEMORY EPHEMERAL REQUEST STORE ─────────────────────────────────────────
const requests = new Map();
const TTL = 30 * 60 * 1000; // 30 minutes self-destruct

const clean = () => {
  const now = Date.now();
  for (const [id, r] of requests) {
    if (now > r.expires) requests.delete(id);
  }
};
setInterval(clean, 60_000).unref();

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Health Check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    name: 'FormRelay Server',
    version: '0.4.0',
    security: 'Hardened E2E',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// Static Assets
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));
app.get('/recipient.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'recipient.js')));
app.get('/icons/:file', (req, res) => {
  const safeFile = path.basename(req.params.file);
  const filePath = path.join(__dirname, 'public', 'icons', safeFile);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// AI Field Grouping Endpoint (Rate-limited, sanitized)
app.post('/api/ai/group-fields', aiLimiter, async (req, res) => {
  try {
    const fields = req.body?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Provide at least 1 field to group.' });
    }
    if (fields.length > 50) {
      return res.status(400).json({ ok: false, error: 'Maximum 50 fields allowed per request.' });
    }

    // Filter out any sensitive fields from reaching AI
    const safeFields = fields
      .filter(f => f && typeof f === 'object')
      .map(f => ({
        key: String(f.key || '').slice(0, 80),
        label: sanitizeText(f.label || ''),
        type: String(f.type || 'text').slice(0, 30),
        options: Array.isArray(f.options) ? f.options.slice(0, 20) : undefined
      }))
      .filter(f => !SENSITIVE_PATTERN.test(f.label) && !SENSITIVE_PATTERN.test(f.key));

    const result = await groupFieldsByPerson(safeFields);
    if (!result.ok) return res.status(result.needsApiKey ? 503 : 500).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'AI grouping failed: ' + err.message });
  }
});

// AI Document & Resume Field Extractor ("Upload to Fill")
app.post('/api/ai/extract-profile', aiLimiter, async (req, res) => {
  try {
    const { text, base64Data, mimeType, fields } = req.body || {};
    if (!text && !base64Data) {
      return res.status(400).json({ ok: false, error: 'Provide text or uploaded file.' });
    }
    const result = await extractProfileData({ text, base64Data, mimeType, fields });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Extraction failed: ' + err.message });
  }
});

// AI Question Explainer & Translator
app.post('/api/ai/explain', aiLimiter, async (req, res) => {
  try {
    const { label, lang } = req.body || {};
    if (!label) return res.status(400).json({ ok: false, error: 'Question label required.' });
    const result = await explainQuestion({ label, lang });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Explanation failed: ' + err.message });
  }
});

// Create Delegation Request
app.post('/api/requests', createLimiter, (req, res) => {
  clean();
  const fields = req.body?.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 20) {
    return res.status(400).json({ error: 'Select between 1 and 20 fields.' });
  }

  const allowedTypes = ['text', 'tel', 'email', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group'];

  // Strict field validator
  for (const f of fields) {
    if (!f || typeof f !== 'object') return res.status(400).json({ error: 'Malformed field definition.' });
    if (FORBIDDEN_KEYS.has(f.key)) return res.status(400).json({ error: 'Illegal field key.' });
    if (!f.key || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.key)) return res.status(400).json({ error: 'Invalid field key format.' });
    if (typeof f.label !== 'string' || f.label.trim().length === 0 || f.label.length > 1000) {
      return res.status(400).json({ error: 'Invalid field label length.' });
    }
    if (!allowedTypes.includes(f.type)) {
      return res.status(400).json({ error: `Unsupported field type: ${f.type}` });
    }
    // Block sensitive authentication fields
    if (SENSITIVE_PATTERN.test(f.label) || SENSITIVE_PATTERN.test(f.key)) {
      return res.status(400).json({ error: 'Sensitive credentials or authentication fields cannot be delegated.' });
    }
  }

  // Ensure unique keys
  if (new Set(fields.map(f => f.key)).size !== fields.length) {
    return res.status(400).json({ error: 'Duplicate field keys detected.' });
  }

  // 128-bit cryptographically secure Request ID & 256-bit Owner Token
  const id = crypto.randomBytes(16).toString('hex');
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const ownerHash = crypto.createHash('sha256').update(ownerToken).digest('hex');

  const enhancedFields = enhanceFieldsWithAI(fields);

  requests.set(id, {
    fields: enhancedFields,
    ownerHash,
    expires: Date.now() + TTL,
    answers: null,
    submittedAt: null
  });

  const url = `${req.protocol}://${req.get('host')}/r/${id}`;
  res.status(201).json({
    id,
    ownerToken,
    url,
    expiresInMinutes: 30
  });
});

function findRequest(req, res) {
  const id = req.params.id;
  if (!/^[a-f0-9]{32}$/.test(id)) {
    res.status(404).json({ error: 'Invalid request identifier format.' });
    return null;
  }
  const r = requests.get(id);
  if (!r || Date.now() > r.expires) {
    res.status(404).json({ error: 'Request expired or not found.' });
    return null;
  }
  return r;
}

function verifyOwner(req, res, r) {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(403).json({ error: 'Authorization token required.' });
    return false;
  }
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  // Constant-time comparison prevents side-channel timing attacks
  if (hash.length !== r.ownerHash.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(r.ownerHash))) {
    res.status(403).json({ error: 'Access denied: Invalid owner token.' });
    return false;
  }
  return true;
}

// Recipient Form Page
app.get('/r/:id', (req, res) => {
  if (!findRequest(req, res)) return;
  res.sendFile(path.join(__dirname, 'public', 'recipient.html'));
});

// Fetch Fields for Recipient (Excludes sensitive owner tokens)
app.get('/api/requests/:id/fields', (req, res) => {
  const r = findRequest(req, res);
  if (r) {
    res.json({
      fields: r.fields,
      submitted: Boolean(r.answers),
      expiresAt: r.expires
    });
  }
});

// Real-Time Progress Beacon from Recipient
app.post('/api/requests/:id/progress', (req, res) => {
  const r = findRequest(req, res);
  if (!r) return;
  const status = String(req.body?.status || 'active').slice(0, 30);
  const filledCount = Number(req.body?.filledCount) || 0;
  const totalCount = Number(req.body?.totalCount) || (r.fields || []).length;
  r.progress = {
    status,
    filledCount,
    totalCount,
    updatedAt: Date.now()
  };
  res.json({ ok: true });
});

// Recipient Answers Submission (Single-submission policy, strict sanitization & smart normalization)
app.post('/api/requests/:id/answer', answerLimiter, (req, res) => {
  const r = findRequest(req, res);
  if (!r) return;
  if (r.answers) {
    return res.status(409).json({ error: 'This request has already been answered and submitted.' });
  }

  const incoming = req.body?.answers;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Invalid answers payload.' });
  }

  const answers = Object.create(null);
  for (const f of r.fields) {
    const rawVal = incoming[f.key];
    if (typeof rawVal !== 'string') {
      return res.status(400).json({ error: `Missing or invalid answer for "${f.label}".` });
    }
    // Limit answer length to 1000 characters, sanitize, and run smart normalization
    const clean = sanitizeText(rawVal);
    answers[f.key] = normalizeAnswer(f.type, clean, f.simplifiedLabel || f.label);
  }

  r.answers = answers;
  r.submittedAt = Date.now();
  r.progress = { status: 'submitted', filledCount: r.fields.length, totalCount: r.fields.length, updatedAt: Date.now() };
  res.json({ ok: true, message: 'Answers securely stored and ready for real-time autofill.' });
});

// Polling Status (Owner Only)
app.get('/api/requests/:id/status', (req, res) => {
  const r = findRequest(req, res);
  if (!r || !verifyOwner(req, res, r)) return;
  res.json({
    submitted: Boolean(r.answers),
    answers: r.answers,
    submittedAt: r.submittedAt,
    progress: r.progress || null
  });
});

// QR Code Image Generation
app.get('/api/requests/:id/qr.png', async (req, res) => {
  const r = findRequest(req, res);
  if (!r) return;
  try {
    const url = `${req.protocol}://${req.get('host')}/r/${req.params.id}`;
    res.type('png');
    res.send(await QRCode.toBuffer(url, {
      width: 320,
      margin: 2,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    }));
  } catch (e) {
    res.status(500).json({ error: 'QR generation error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🛡️ FormRelay Hardened Server listening on port ${PORT}`);
});
