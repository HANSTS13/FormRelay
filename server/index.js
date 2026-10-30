const express=require('express');
const crypto=require('crypto');
const QRCode=require('qrcode');
const path=require('path');
const fs=require('fs');
const { enhanceFieldsWithAI, groupFieldsByPerson } = require('./ai');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) { const v = (m[2]||'').trim().replace(/^["']|["']$/g,''); if (!process.env[m[1]]) process.env[m[1]] = v; }
  }
}

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Access-Control-Allow-Origin','*');
  res.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS')return res.sendStatus(204);
  next();
});

const requests=new Map();
const TTL=30*60*1000;
const clean=()=>{for(const [id,r] of requests)if(Date.now()>r.expires)requests.delete(id)};
setInterval(clean,60_000).unref();

app.get('/health',(req,res)=>res.json({ok:true,aiConfigured:Boolean(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY)}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/demo',(req,res)=>res.sendFile(path.join(__dirname,'public','demo.html')));
app.get('/recipient.js',(req,res)=>res.sendFile(path.join(__dirname,'public','recipient.js')));

// ── AI Smart Group Endpoint ────────────────────────────────────────────────
app.post('/api/ai/group-fields', async (req,res) => {
  try {
    const fields = req.body?.fields;
    if(!Array.isArray(fields)||fields.length===0) return res.status(400).json({ok:false,error:'Provide at least 1 field'});
    const result = await groupFieldsByPerson(fields);
    if(!result.ok) return res.status(result.needsApiKey?503:500).json(result);
    res.json(result);
  } catch(err) {
    res.status(500).json({ok:false,error:err.message});
  }
});

app.post('/api/requests',(req,res)=>{
  clean();
  const fields=req.body?.fields;
  if(!Array.isArray(fields)||fields.length<1||fields.length>20)return res.status(400).json({error:'Select 1-20 fields'});
  if(!fields.every(f=>typeof f.key==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(f.key)&&typeof f.label==='string'&&f.label.length>0&&f.label.length<=100&&['text','tel','email','number','date','select'].includes(f.type)))return res.status(400).json({error:'Unsupported fields'});
  if(new Set(fields.map(f=>f.key)).size!==fields.length)return res.status(400).json({error:'Duplicate field keys'});
  const id=crypto.randomBytes(16).toString('hex');
  const ownerToken=crypto.randomBytes(32).toString('hex');
  const enhancedFields=enhanceFieldsWithAI(fields);
  requests.set(id,{fields:enhancedFields,ownerHash:crypto.createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+TTL,answers:null});
  res.status(201).json({id,ownerToken,url:`${req.protocol}://${req.get('host')}/r/${id}`,expiresInMinutes:30});
});

function find(req,res){const r=requests.get(req.params.id);if(!r||Date.now()>r.expires){res.status(404).json({error:'Request expired or not found'});return null;}return r}
function owner(req,res,r){const token=(req.get('Authorization')||'').replace(/^Bearer /,'');const hash=crypto.createHash('sha256').update(token).digest('hex');if(!token||hash.length!==r.ownerHash.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(r.ownerHash))){res.status(403).json({error:'Access denied'});return false;}return true}

app.get('/r/:id',(req,res)=>{if(!find(req,res))return;res.sendFile(path.join(__dirname,'public','recipient.html'))});
app.get('/api/requests/:id/fields',(req,res)=>{const r=find(req,res);if(r)res.json({fields:r.fields,submitted:!!r.answers})});
app.post('/api/requests/:id/answer',(req,res)=>{
  const r=find(req,res);if(!r)return;
  if(r.answers)return res.status(409).json({error:'Already submitted'});
  const incoming=req.body?.answers;
  if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))return res.status(400).json({error:'Invalid answers'});
  const answers={};
  for(const f of r.fields){const v=incoming[f.key];if(typeof v!=='string'||v.length>500)return res.status(400).json({error:`Invalid answer for ${f.label}`});answers[f.key]=v;}
  r.answers=answers;
  res.json({ok:true});
});
app.get('/api/requests/:id/status',(req,res)=>{const r=find(req,res);if(!r||!owner(req,res,r))return;res.json({submitted:!!r.answers,answers:r.answers})});
app.get('/api/requests/:id/qr.png',async(req,res)=>{const r=find(req,res);if(!r)return;try{const url=`${req.protocol}://${req.get('host')}/r/${req.params.id}`;res.type('png');res.send(await QRCode.toBuffer(url,{width:260,margin:2}))}catch(e){res.status(500).json({error:'QR generation error'})}});
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log(`FormRelay server on ${process.env.PORT||3000}`));
