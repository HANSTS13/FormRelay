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
test('background request creation binds the configured backend, session key and original document',async()=>{
 const session={formrelayAccess:{origin:environment.PUBLIC_BASE_URL,key}};let listener,sent,track;
 const context={URL,Error,Date,chrome:{runtime:{id:'trusted-extension',onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async key=>({[key]:session[key]}),set:async data=>Object.assign(session,data)}},tabs:{get:async()=>({id:1,url:'https://original.example/application'}),sendMessage:async(id,msg)=>{if(msg.action==='PREPARE_REQUEST')return {ok:true,documentToken:'document-a',fields};if(msg.action==='TRACK')track=msg;return {ok:true}}}},fetch:async(url,options)=>{sent={url,options};return {ok:true,status:201,json:async()=>({id:'a'.repeat(32),ownerToken:'owner-only',url:environment.PUBLIC_BASE_URL+'/r/'+'a'.repeat(32),expiresInMinutes:30})}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/background.js'),'utf8'),context);
 const reply=await new Promise(resolve=>listener({action:'CREATE_REQUEST',tabId:1,base:environment.PUBLIC_BASE_URL},{id:'trusted-extension'},resolve));
 assert.equal(reply.ok,true);assert.equal(sent.url,environment.PUBLIC_BASE_URL+'/api/requests');assert.equal(sent.options.headers['X-FormRelay-Key'],key);assert.equal(track.track.token,'owner-only');assert.equal(track.documentToken,'document-a');assert.equal(reply.request.token,undefined);assert.equal(session['formrelay.tab.1'].request.token,'owner-only');
 const invalid=await new Promise(resolve=>listener({action:'CREATE_REQUEST',tabId:2,base:'https://other.onrender.com'},{id:'trusted-extension'},resolve));assert.equal(invalid.ok,false);
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


test('localhost development works without deployment settings and protects response ownership',async()=>{
 const s=await launch({NODE_ENV:'development'});try{
 assert.equal((await s.request('/demo')).status,200);
 const created=await (await s.request('/api/requests',{method:'POST',body:JSON.stringify({fields})})).json();
 assert.match(created.url,/^http:\/\/127\.0\.0\.1:\d+\/r\//);
 assert.equal((await s.request('/api/requests/'+created.id+'/status')).status,403);
 }finally{await s.stop()}
});
test('LAN recipient links and QR use the configured address while localhost polling remains available',async()=>{
 const LAN_BASE_URL='http://192.168.50.20:3000'; // Fictional fixture; never used as an app default.
 const s=await launch({NODE_ENV:'development',LAN_BASE_URL,CREATION_KEY:key});try{
 assert.equal((await s.create({'X-FormRelay-Key':''})).status,401);
 const response=await s.create();assert.equal(response.status,201);const created=await response.json();
 assert.equal(created.url,LAN_BASE_URL+'/r/'+created.id);
 const qr=await s.request('/api/requests/'+created.id+'/qr.png');
 const expected=await require('qrcode').toBuffer(created.url,{width:260,margin:2});assert.deepEqual(Buffer.from(await qr.arrayBuffer()),expected);
 const recipient=await s.request('/r/'+created.id);assert.equal(recipient.status,200);
 assert.equal((await s.request('/api/requests/'+created.id+'/fields',{headers:{Origin:LAN_BASE_URL}})).status,200);
 const submitted=await s.request('/api/requests/'+created.id+'/answer',{method:'POST',headers:{Origin:LAN_BASE_URL},body:JSON.stringify({answers:{guardian:'Morgan Example'}})});assert.equal(submitted.status,200);
 const status=await s.request('/api/requests/'+created.id+'/status',{headers:{Authorization:'Bearer '+created.ownerToken}});
 assert.equal((await status.json()).answers.guardian,'Morgan Example');
 assert.equal((await s.request('/api/requests/'+created.id+'/answer',{method:'POST',headers:{Origin:'http://untrusted.example'},body:JSON.stringify({answers:{guardian:'Changed'}})})).status,403);
 }finally{await s.stop()}
});
test('LAN settings cannot weaken production security or target arbitrary public hosts',()=>{
 for(const LAN_BASE_URL of ['http://example.com:3000','http://8.8.8.8:3000','http://192.168.50.20:4000','http://192.168.50.20:3000/path','http://user:pass@192.168.50.20:3000'])assert.throws(()=>createApp({NODE_ENV:'development',LAN_BASE_URL,CREATION_KEY:key}),/LAN_BASE_URL/);
 assert.throws(()=>createApp({...environment,LAN_BASE_URL:'http://192.168.50.20:3000'}),/LAN_BASE_URL/);
 assert.throws(()=>createApp({NODE_ENV:'development',LAN_BASE_URL:'http://192.168.50.20:3000'}),/CREATION_KEY/);
});


test('typed fields accept only offered choices and booleans, with safe metadata and required checks',async()=>{
 const s=await launch({NODE_ENV:'development'});try{
 const definitions=[{key:'bio',label:'Biography',type:'textarea'},{key:'country',label:'Country',type:'select',options:[{value:'choice_0',label:'Canada',selected:true,actual:'private-existing-value'}]},{key:'contact',label:'Contact method',type:'radio',options:[{value:'choice_0',label:'Email'},{value:'choice_1',label:'Phone'}]},{key:'updates',label:'Send updates',type:'checkbox'}];
 const make=fields=>s.request('/api/requests',{method:'POST',body:JSON.stringify({fields})});
 const response=await make(definitions);assert.equal(response.status,201);const created=await response.json();
 const metadata=await (await s.request('/api/requests/'+created.id+'/fields')).json();assert.equal(JSON.stringify(metadata).includes('private-existing-value'),false);assert.equal(JSON.stringify(metadata).includes('selected'),false);
 const submit=answers=>s.request('/api/requests/'+created.id+'/answer',{method:'POST',body:JSON.stringify({answers})});
 const valid={bio:'Fictional biography',country:'choice_0',contact:'choice_1',updates:false};
 assert.equal((await submit({...valid,country:'Canada'})).status,400);assert.equal((await submit({...valid,contact:'unknown'})).status,400);assert.equal((await submit({...valid,updates:'false'})).status,400);
 assert.equal((await submit(valid)).status,200);
 const required=await (await make([{key:'agree',label:'Agreement',type:'checkbox',required:true}])).json();
 assert.equal((await s.request('/api/requests/'+required.id+'/answer',{method:'POST',body:JSON.stringify({answers:{agree:false}})})).status,400);
 for(const fields of [[{key:'s',label:'Country',type:'select',options:[]}],[{key:'s',label:'Country',type:'select',options:[{value:'x',label:'A'},{value:'x',label:'B'}]}],[{key:'x',label:'Authentication code',type:'textarea'}],[{key:'__proto__',label:'Name',type:'text'}]])assert.equal((await make(fields)).status,400);
 const group=await (await make([{key:'interests',label:'Interests',type:'checkbox-group',required:true,options:[{value:'choice_0',label:'Music'}]}])).json();
 for(const value of [[],['unknown'],['choice_0','choice_0'],true])assert.equal((await s.request('/api/requests/'+group.id+'/answer',{method:'POST',body:JSON.stringify({answers:{interests:value}})})).status,400);
 assert.equal((await s.request('/api/requests/'+group.id+'/answer',{method:'POST',body:JSON.stringify({answers:{interests:['choice_0']}})})).status,200);
 for(const label of ['creditCard','creditcard','otpCode','authCode'])assert.equal((await make([{key:'x',label,type:'text'}])).status,400);
 assert.equal((await make([{key:'shipping',label:'Shipping address',type:'textarea'}])).status,201);
 }finally{await s.stop()}
});


test('worker session survives restart, isolates tabs/documents, rejects stale updates and cleans closed tabs',async()=>{
 const session={};const tabs={1:{id:1,url:'https://one.example/form'},2:{id:2,url:'https://two.example/form'}};
 const load=()=>{let listener,removed;const context={URL,Error,Date,chrome:{runtime:{id:'trusted',onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async key=>({[key]:session[key]}),set:async data=>Object.assign(session,data),remove:async key=>{delete session[key]}}},tabs:{get:async id=>tabs[id],onRemoved:{addListener:fn=>removed=fn},onUpdated:{addListener:()=>{}}}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/background.js'),'utf8'),context);return {call:(msg,sender={id:'trusted'})=>new Promise(resolve=>listener(msg,sender,resolve)),removed}};
 let worker=load();const sender={id:'trusted',tab:tabs[1],url:tabs[1].url,documentId:'doc-a'};
 assert.equal((await worker.call({action:'INIT',documentToken:'a'},sender)).ok,true);
 await worker.call({action:'STATE_UPDATE',documentToken:'a',state:{origin:'https://one.example',selection:fields,status:'selected'}},sender);
 session['formrelay.tab.1'].request={id:'a'.repeat(32),token:'private-owner',base:'http://localhost:3000',url:'http://localhost:3000/r/'+'a'.repeat(32),sourceOrigin:'https://one.example',expiresAt:Date.now()+60000,fields};
 worker=load();const restored=await worker.call({action:'INIT',documentToken:'b'},{...sender,documentId:'doc-b'});assert.equal(restored.request.token,'private-owner');assert.equal(session['formrelay.tab.1'].view,null);
 assert.equal((await worker.call({action:'STATE_UPDATE',documentToken:'a',state:{status:'stale'}},sender)).ok,false);
 assert.equal((await worker.call({action:'INIT',documentToken:'two'},{id:'trusted',tab:tabs[2],url:tabs[2].url,documentId:'two'})).request,null);
 const publicState=await worker.call({action:'GET_TAB_STATE',tabId:1});assert.equal(publicState.request.token,undefined);
 tabs[1].url='https://another.example/form';assert.equal((await worker.call({action:'GET_TAB_STATE',tabId:1})).request,null);
 worker.removed(1);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(session['formrelay.tab.1'],undefined);
});
