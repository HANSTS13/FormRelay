const express=require('express');
const crypto=require('crypto');
const QRCode=require('qrcode');
const path=require('path');
const {rateLimit}=require('express-rate-limit');
const {createStore}=require('./store');

function createApp(env=process.env){
const production=env.NODE_ENV==='production';
const creationKey=env.CREATION_KEY||'';
const configuredURL=env.PUBLIC_BASE_URL||env.RENDER_EXTERNAL_URL||'';
const publicURL=configuredURL?new URL(configuredURL):null;
if(publicURL&&(publicURL.username||publicURL.password||publicURL.search||publicURL.hash||publicURL.pathname!=='/'))throw Error('PUBLIC_BASE_URL must be an origin without a path or credentials');
if(production&&(!publicURL||publicURL.protocol!=='https:'))throw Error('Production requires an HTTPS PUBLIC_BASE_URL or RENDER_EXTERNAL_URL');
if(publicURL&&!['http:','https:'].includes(publicURL.protocol))throw Error('Invalid public URL protocol');
if(production&&creationKey.length<32)throw Error('Production requires CREATION_KEY with at least 32 characters');
const store=createStore(env.DB_FILE||':memory:');
const app=express();
app.disable('x-powered-by');
// Render terminates HTTPS at its trusted reverse proxy.
if(env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use((req,res,next)=>{
 res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
 if(production){res.set('Strict-Transport-Security','max-age=31536000');if(!req.secure){if(req.method==='GET'||req.method==='HEAD')return res.redirect(308,publicURL.origin+req.originalUrl);return res.status(400).json({error:'HTTPS required'})}}
 next();
});
app.use('/api',(req,res,next)=>{
 // No wildcard CORS or cookie authentication. Recipients use this server's origin;
 // Chrome extension fetches use explicit host_permissions.
 const origin=req.get('Origin');
 const expected=publicURL?.origin||req.protocol+'://'+req.get('host');
 if(origin&&origin!==expected&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return res.status(403).json({error:'Untrusted origin'});
 next();
});
const apiLimit=rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests; wait a minute'}});
const createLimit=rateLimit({windowMs:60*60_000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Request creation limit reached; try again later'}});
app.use('/api',apiLimit);
app.use(express.json({limit:'32kb',strict:true}));
const requestURL=(req,id)=>(publicURL?.origin||req.protocol+'://'+req.get('host'))+'/r/'+id;
function authorizeCreation(req,res,next){
 if(!creationKey)return next();
 const supplied=req.get('X-FormRelay-Key')||'';
 const digest=value=>crypto.createHash('sha256').update(value).digest();
 if(!crypto.timingSafeEqual(digest(supplied),digest(creationKey)))return res.status(401).json({error:'Enter the deployment access key in the extension'});
 next();
}
const TTL=30*60*1000;
const clean=()=>store.clean();
const cleanupTimer=setInterval(clean,60_000);cleanupTimer.unref();
clean();
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/demo',(req,res)=>res.sendFile(path.join(__dirname,'public','demo.html')));
app.get('/demo.js',(req,res)=>res.sendFile(path.join(__dirname,'public','demo.js')));
app.get('/recipient.js',(req,res)=>res.sendFile(path.join(__dirname,'public','recipient.js')));
app.post('/api/requests',createLimit,authorizeCreation,(req,res)=>{
  clean();
  if(store.count()>=1000)return res.status(503).json({error:'Demo capacity reached; try again after requests expire'});
  const fields=req.body?.fields;
  if(!Array.isArray(fields)||fields.length<1||fields.length>20)return res.status(400).json({error:'Select 1-20 fields'});
  if(!fields.every(f=>f&&typeof f==='object'&&typeof f.key==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(f.key)&&!['__proto__','prototype','constructor'].includes(f.key)&&typeof f.label==='string'&&f.label.length>0&&f.label.length<=100&&['text','tel','email','number','date'].includes(f.type)))return res.status(400).json({error:'Unsupported fields'});
  if(new Set(fields.map(f=>f.key)).size!==fields.length)return res.status(400).json({error:'Duplicate field keys'});
  const id=crypto.randomBytes(16).toString('hex');
  const ownerToken=crypto.randomBytes(32).toString('hex');
  const definitions=fields.map(({key,label,type})=>({key,label,type}));
  if(definitions.some(f=>/password|otp|one.time|verification|token|secret|credential|cvv|cvc|card|credit|debit|pin|aadhaar|aadhar|ssn/i.test(f.label)))return res.status(400).json({error:'Sensitive fields are not supported'});
  store.create(id,{fields:definitions,ownerHash:crypto.createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+TTL,answers:null});
  res.status(201).json({id,ownerToken,url:requestURL(req,id),expiresInMinutes:30});
});
function find(req,res){const r=store.get(req.params.id);if(!r){res.status(404).json({error:'Request expired or not found'});return null;}return r}
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
 if(!store.answer(req.params.id,answers))return res.status(409).json({error:'Already submitted or expired'});
 res.json({ok:true});
});
app.get('/api/requests/:id/status',(req,res)=>{const r=find(req,res);if(!r||!owner(req,res,r))return;res.json({submitted:!!r.answers,answers:r.answers})});
app.get('/api/requests/:id/qr.png',async(req,res)=>{const r=find(req,res);if(!r)return;try{const url=requestURL(req,req.params.id);res.type('png');res.send(await QRCode.toBuffer(url,{width:260,margin:2}))}catch(e){res.status(500).json({error:'QR generation error'})}});
app.use((err,req,res,next)=>{
 const status=err.status===413?413:err.type==='entity.parse.failed'?400:500;
 res.status(status).json({error:status===500?'Server error':'Invalid request body'});
});
return {app,store,close(){clearInterval(cleanupTimer);store.close()}};
}
if(require.main===module){
 const instance=createApp();
 const server=instance.app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('FormRelay server on '+(process.env.PORT||3000)));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{instance.close();process.exit(0)}));
}
module.exports={createApp};
