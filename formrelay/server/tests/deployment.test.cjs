const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {createApp}=require('../index');
const key='fictional-deployment-key-for-tests-only';
const environment={NODE_ENV:'production',TRUST_PROXY:'1',PUBLIC_BASE_URL:'https://formrelay-test.onrender.com',CREATION_KEY:key};
const fields=[{key:'guardian',label:'Guardian Name',type:'text'}];
async function launch(env=environment){
 const instance=createApp(env);const server=await new Promise(resolve=>{const s=instance.app.listen(0,'127.0.0.1',()=>resolve(s))});
 const base='http://127.0.0.1:'+server.address().port;
 return {...instance,async stop(){await new Promise(resolve=>server.close(resolve));instance.close()},
 request(url,options={}){return fetch(base+url,{...options,redirect:'manual',headers:{'X-Forwarded-Proto':'https','Content-Type':'application/json',...options.headers}})},
 create(headers={}){return this.request('/api/requests',{method:'POST',headers:{'X-FormRelay-Key':key,...headers},body:JSON.stringify({fields})})}};
}
test('production fails closed without HTTPS configuration or a strong creation key',()=>{
 assert.throws(()=>createApp({NODE_ENV:'production'}),/HTTPS/);
 assert.throws(()=>createApp({...environment,CREATION_KEY:'short'}),/CREATION_KEY/);
 assert.throws(()=>createApp({...environment,PUBLIC_BASE_URL:'https://user:pass@example.com/path'}),/origin/);
});
test('trusted HTTPS proxy, canonical links, creation authentication, CORS and security headers',async()=>{
 const s=await launch();try{
 const health=await s.request('/health');assert.equal(health.status,200);assert.equal(health.headers.get('referrer-policy'),'no-referrer');assert.match(health.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal((await s.request('/health',{headers:{'X-Forwarded-Proto':'http'}})).headers.get('location'),environment.PUBLIC_BASE_URL+'/health');
 assert.equal((await s.create({'X-Forwarded-Proto':'http'})).status,400);
 assert.equal((await s.create({'X-FormRelay-Key':''})).status,401);
 assert.equal((await s.create({Origin:'https://untrusted.example'})).status,403);
 const response=await s.create({Host:'attacker.invalid','X-Forwarded-Host':'attacker.invalid',Origin:'chrome-extension://'+'a'.repeat(32)});
 assert.equal(response.status,201);const created=await response.json();assert.equal(created.url,environment.PUBLIC_BASE_URL+'/r/'+created.id);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 assert.equal((await s.request('/api/requests/'+created.id+'/qr.png')).status,200);
 const metadata=await (await s.request('/api/requests/'+created.id+'/fields')).json();assert.equal(metadata.ownerToken,undefined);
 assert.equal((await s.request('/api/requests/'+created.id+'/status')).status,403);
 assert.equal((await s.request('/api/requests',{method:'POST',body:'{invalid','headers':{'X-FormRelay-Key':key}})).status,400);
 }finally{await s.stop()}
});
test('creation and polling rate limits return 429',async()=>{
 const s=await launch();try{
 for(let i=0;i<20;i++)assert.equal((await s.create()).status,201);
 assert.equal((await s.create()).status,429);
 }finally{await s.stop()}
 const p=await launch();try{
 for(let i=0;i<300;i++)assert.equal((await p.request('/api/requests/missing/fields')).status,404);
 assert.equal((await p.request('/api/requests/missing/fields')).status,429);
 }finally{await p.stop()}
});
test('SQLite survives restart, preserves owner authorization, expires data, and prevents duplicate writes',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'formrelay-test-'));const DB_FILE=path.join(directory,'requests.sqlite');let s;
 try{
 s=await launch({...environment,DB_FILE});const created=await (await s.create()).json();
 assert.equal((await s.request('/api/requests/'+created.id+'/answer',{method:'POST',body:JSON.stringify({answers:{guardian:'Morgan Example'}})})).status,200);
 await s.stop();s=await launch({...environment,DB_FILE});
 assert.equal((await s.request('/api/requests/'+created.id+'/status',{headers:{Authorization:'Bearer wrong'}})).status,403);
 const state=await (await s.request('/api/requests/'+created.id+'/status',{headers:{Authorization:'Bearer '+created.ownerToken}})).json();assert.equal(state.answers.guardian,'Morgan Example');
 assert.equal((await s.request('/api/requests/'+created.id+'/answer',{method:'POST',body:JSON.stringify({answers:{guardian:'Changed'}})})).status,409);
 s.store.create('expired',{fields,ownerHash:'hash',expires:Date.now()-1});
 assert.equal((await s.request('/api/requests/expired/fields')).status,404);s.store.clean();assert.equal(s.store.count(),1);
 assert.equal(fs.readFileSync(DB_FILE).includes(Buffer.from(created.ownerToken)),false);
 }finally{if(s)await s.stop();fs.rmSync(directory,{recursive:true,force:true})}
});
test('extension popup sends creation key only to the configured backend and builds matching link/QR URLs',async()=>{
 const extension=path.join(__dirname,'../../extension');const elements={};
 for(const id of ['base','accessKey','fields','message','qr','link','select','finish','create','undo'])elements[id]={value:'',style:{}};
 elements.base.value=environment.PUBLIC_BASE_URL;elements.accessKey.value=key;
 let sent,track,saved={};
 const context={URL,console,document:{getElementById:id=>elements[id]},chrome:{
 storage:{local:{get:(_,cb)=>cb({}),set:()=>{}},session:{get:(_,cb)=>cb?cb({}):Promise.resolve(saved),set:async data=>{saved=data}}},
 tabs:{query:async()=>[{id:1}],sendMessage:async(id,msg)=>{if(msg.action==='GET_SELECTION')return {fields};track=msg}},scripting:{executeScript:async()=>{}}},
 fetch:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({id:'a'.repeat(32),ownerToken:'owner-only',url:environment.PUBLIC_BASE_URL+'/r/'+'a'.repeat(32)})}}};
 vm.runInNewContext(fs.readFileSync(path.join(extension,'popup.js'),'utf8'),context);await elements.create.onclick();
 assert.equal(sent.url,environment.PUBLIC_BASE_URL+'/api/requests');assert.equal(sent.options.headers['X-FormRelay-Key'],key);
 assert.equal(track.track.base,environment.PUBLIC_BASE_URL);assert.equal(track.track.token,'owner-only');
 assert.equal(elements.qr.src,environment.PUBLIC_BASE_URL+'/api/requests/'+'a'.repeat(32)+'/qr.png');assert.equal(elements.link.href,environment.PUBLIC_BASE_URL+'/r/'+'a'.repeat(32));
 sent=null;elements.base.value='https://other.onrender.com';await elements.create.onclick();assert.equal(sent,null);assert.match(elements.message.textContent,/Backend changed/);
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));assert.equal(manifest.manifest_version,3);assert.match(manifest.content_security_policy.extension_pages,/connect-src[^;]*https:\/\/\*\.onrender\.com/);
});
test('extension service worker polls the configured HTTPS backend with only the owner token',async()=>{
 let listener,sent;
 const context={URL,Error,chrome:{runtime:{id:'trusted-extension',onMessage:{addListener:fn=>listener=fn}}},fetch:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({submitted:false})}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/background.js'),'utf8'),context);
 const msg={action:'FETCH',base:environment.PUBLIC_BASE_URL,path:'/api/requests/'+'a'.repeat(32)+'/status',token:'owner-only'};
 const reply=await new Promise(resolve=>listener(msg,{id:'trusted-extension'},resolve));assert.equal(reply.ok,true);
 assert.equal(sent.url,environment.PUBLIC_BASE_URL+msg.path);assert.equal(sent.options.headers.Authorization,'Bearer owner-only');
 const invalid=await new Promise(resolve=>listener({...msg,base:'http://insecure.example'},{id:'trusted-extension'},resolve));assert.equal(invalid.ok,false);
 assert.equal(listener(msg,{id:'another-extension'},()=>{}),undefined);
});
