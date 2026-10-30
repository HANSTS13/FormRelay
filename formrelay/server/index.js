const express=require('express');
const crypto=require('crypto');
const QRCode=require('qrcode');
const path=require('path');
const {rateLimit}=require('express-rate-limit');
const {createStore}=require('./store');
const {definitions,validateAnswers}=require('./fields');
const {enhanceFieldsWithAI}=require('./ai');

function createApp(env=process.env){
const production=env.NODE_ENV==='production';
const lanURL=env.LAN_BASE_URL?new URL(env.LAN_BASE_URL):null;
if(lanURL){
 const parts=lanURL.hostname.split('.').map(Number);
 const privateIPv4=require('net').isIP(lanURL.hostname)===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168));
 if(production||lanURL.protocol!=='http:'||!privateIPv4||lanURL.username||lanURL.password||lanURL.search||lanURL.hash||lanURL.pathname!=='/'||lanURL.port!==String(env.PORT||3000))throw Error('LAN_BASE_URL is development-only and must be http://PRIVATE_WIFI_IPV4:PORT with no path or credentials');
}
const creationKey=env.CREATION_KEY||'';
const configuredURL=env.PUBLIC_BASE_URL||env.RENDER_EXTERNAL_URL||'';
const publicURL=configuredURL?new URL(configuredURL):null;
if(publicURL&&(publicURL.username||publicURL.password||publicURL.search||publicURL.hash||publicURL.pathname!=='/'))throw Error('PUBLIC_BASE_URL must be an origin without a path or credentials');
if(production&&(!publicURL||publicURL.protocol!=='https:'))throw Error('Production requires an HTTPS PUBLIC_BASE_URL or RENDER_EXTERNAL_URL');
if(publicURL&&!['http:','https:'].includes(publicURL.protocol))throw Error('Invalid public URL protocol');
if((production||lanURL)&&creationKey.length<32)throw Error('Production and LAN demos require CREATION_KEY with at least 32 characters');
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
 if(origin&&origin!==expected&&origin!==lanURL?.origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return res.status(403).json({error:'Untrusted origin'});
 next();
});
const apiLimit=rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests; wait a minute'}});
const createLimit=rateLimit({windowMs:60*60_000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Request creation limit reached; try again later'}});
app.use('/api',apiLimit);
app.use(express.json({limit:'32kb',strict:true}));
const requestURL=(req,id)=>(lanURL?.origin||publicURL?.origin||req.protocol+'://'+req.get('host'))+'/r/'+id;
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
  let fields;try{fields=enhanceFieldsWithAI(definitions(req.body?.fields))}catch(error){return res.status(400).json({error:error.message})}
  const id=crypto.randomBytes(16).toString('hex');
  const ownerToken=crypto.randomBytes(32).toString('hex');
  const expiresAt=Date.now()+TTL;
  store.create(id,{fields,ownerHash:crypto.createHash('sha256').update(ownerToken).digest('hex'),expires:expiresAt,answers:null});
  res.status(201).json({id,ownerToken,url:requestURL(req,id),expiresInMinutes:30,expiresAt});
});
function find(req,res){const r=store.get(req.params.id);if(!r){res.status(404).json({error:'Request expired or not found'});return null;}return r}
function owner(req,res,r){const token=(req.get('Authorization')||'').replace(/^Bearer /,'');const hash=crypto.createHash('sha256').update(token).digest('hex');if(!token||hash.length!==r.ownerHash.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(r.ownerHash))){res.status(403).json({error:'Access denied'});return false;}return true}
app.get('/r/:id',(req,res)=>{if(!find(req,res))return;res.sendFile(path.join(__dirname,'public','recipient.html'))});
app.get('/api/requests/:id/fields',(req,res)=>{const r=find(req,res);if(r)res.json({fields:r.fields,submitted:!!r.answers})});
app.post('/api/requests/:id/answer',(req,res)=>{
 const r=find(req,res);if(!r)return;
 if(r.answers)return res.status(409).json({error:'Already submitted'});
 let answers;try{answers=validateAnswers(r.fields,req.body?.answers)}catch(error){return res.status(400).json({error:error.message})}
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
 if(!process.env.NODE_ENV)process.env.NODE_ENV='development';
 const instance=createApp();
 const bindAddress=process.env.NODE_ENV==='production'||process.env.LAN_BASE_URL?'0.0.0.0':'127.0.0.1';
 const server=instance.app.listen(process.env.PORT||3000,bindAddress,()=>{
  console.log('FormRelay '+process.env.NODE_ENV+' server: http://localhost:'+(process.env.PORT||3000));
  if(process.env.LAN_BASE_URL)console.log('LAN recipient links use '+new URL(process.env.LAN_BASE_URL).origin+' (same Wi-Fi; HTTP; fictional data only)');
 });
 server.on('error',error=>{instance.close();console.error(error.code==='EADDRINUSE'?'Port '+(process.env.PORT||3000)+' is already in use. Stop the previous FormRelay terminal with Ctrl+C.':error.message);process.exitCode=1});
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{instance.close();process.exit(0)}));
}
module.exports={createApp};
