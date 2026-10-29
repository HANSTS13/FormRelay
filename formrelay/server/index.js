const express=require('express');
const crypto=require('crypto');
const QRCode=require('qrcode');
const path=require('path');
const app=express();
app.disable('x-powered-by');
// Render terminates HTTPS at its trusted reverse proxy.
if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();});
const requests=new Map();
const TTL=30*60*1000;
const clean=()=>{for(const [id,r] of requests)if(Date.now()>r.expires)requests.delete(id)};
setInterval(clean,60_000).unref();
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/demo',(req,res)=>res.sendFile(path.join(__dirname,'public','demo.html')));
app.get('/recipient.js',(req,res)=>res.sendFile(path.join(__dirname,'public','recipient.js')));
app.post('/api/requests',(req,res)=>{
  clean();
  const fields=req.body?.fields;
  if(!Array.isArray(fields)||fields.length<1||fields.length>20)return res.status(400).json({error:'Select 1-20 fields'});
  if(!fields.every(f=>f&&typeof f==='object'&&typeof f.key==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(f.key)&&typeof f.label==='string'&&f.label.length>0&&f.label.length<=100&&['text','tel','email','number','date'].includes(f.type)))return res.status(400).json({error:'Unsupported fields'});
  if(new Set(fields.map(f=>f.key)).size!==fields.length)return res.status(400).json({error:'Duplicate field keys'});
  const id=crypto.randomBytes(16).toString('hex');
  const ownerToken=crypto.randomBytes(32).toString('hex');
  const definitions=fields.map(({key,label,type})=>({key,label,type}));
  if(definitions.some(f=>/password|otp|one.time|verification|token|secret|credential|cvv|cvc|credit|debit|pin|ssn/i.test(f.label)))return res.status(400).json({error:'Sensitive fields are not supported'});
  requests.set(id,{fields:definitions,ownerHash:crypto.createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+TTL,answers:null});
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
 if(Object.keys(incoming).length!==r.fields.length||Object.keys(incoming).some(key=>!r.fields.some(f=>f.key===key)))return res.status(400).json({error:'Unexpected answer fields'});
 const answers=Object.create(null);
 for(const f of r.fields){const v=incoming[f.key];if(typeof v!=='string'||v.length>500||!v.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))return res.status(400).json({error:`Invalid answer for ${f.label}`});if(f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return res.status(400).json({error:'Invalid email'});if(f.type==='number'&&!Number.isFinite(Number(v)))return res.status(400).json({error:'Invalid number'});if(f.type==='tel'&&!/^[+()0-9 .-]{3,40}$/.test(v))return res.status(400).json({error:'Invalid phone'});if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))return res.status(400).json({error:'Invalid date'});answers[f.key]=v;}
 r.answers=answers;
 res.json({ok:true});
});
app.get('/api/requests/:id/status',(req,res)=>{const r=find(req,res);if(!r||!owner(req,res,r))return;res.json({submitted:!!r.answers,answers:r.answers})});
app.get('/api/requests/:id/qr.png',async(req,res)=>{const r=find(req,res);if(!r)return;try{const url=`${req.protocol}://${req.get('host')}/r/${req.params.id}`;res.type('png');res.send(await QRCode.toBuffer(url,{width:260,margin:2}))}catch(e){res.status(500).json({error:'QR generation error'})}});
app.use((err,req,res,next)=>res.status(err.status===413?413:400).json({error:'Invalid request body'}));
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log(`FormRelay server on ${process.env.PORT||3000}`));
