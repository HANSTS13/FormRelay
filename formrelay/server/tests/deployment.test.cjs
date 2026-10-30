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

for(const scenario of [
 {status:400,error:'Unsupported fields',match:/older FormRelay backend/},
 {status:401,error:'Creation key required',match:/access key/},
 {status:403,error:'Origin denied',match:/access policy/},
 {status:404,error:'Not found',match:/Backend URL/},
 {status:429,error:'Too many requests',retryAfter:'120',match:/Retry after 120 seconds/},
 {status:500,error:'Server error',match:/backend terminal/},
 {status:404,nonJSON:true,match:/unexpected page/},
 {status:0,network:true,match:/Backend unavailable/}
]) test('request creation preserves actionable failure details: '+JSON.stringify(scenario),async()=>{
 const session={formrelayAccess:{origin:environment.PUBLIC_BASE_URL,key}};let listener,failed,sent;
 const definitions=[{key:'notes',label:'Fictional notes',type:'textarea'},{key:'choice',label:'Fictional choice',type:'select',options:[{value:'choice_0',label:'Example'}]}];
 const context={URL,Error,Date,chrome:{runtime:{id:'trusted',onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async name=>({[name]:session[name]}),set:async data=>Object.assign(session,data)}},tabs:{get:async()=>({id:1,url:'https://original.example/form'}),sendMessage:async(id,msg)=>{if(msg.action==='PREPARE_REQUEST')return {ok:true,documentToken:'doc',fields:definitions};if(msg.action==='TRACK')assert.fail('Failed creation must not start tracking');if(msg.action==='CREATE_FAILED')failed=msg;return {ok:true}}}},fetch:async(url,options)=>{sent={url,options};if(scenario.network)throw Error('Connection refused');return {ok:false,status:scenario.status,headers:{get:()=>scenario.retryAfter},json:async()=>{if(scenario.nonJSON)throw Error('HTML response');return {error:scenario.error}}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/background.js'),'utf8'),context);
 const reply=await new Promise(resolve=>listener({action:'CREATE_REQUEST',tabId:1,base:environment.PUBLIC_BASE_URL},{id:'trusted'},resolve));
 assert.equal(reply.ok,false);assert.equal(reply.status,scenario.status);assert.match(reply.error,scenario.match);
 assert.equal(failed.error,reply.error);assert.equal(failed.status,scenario.status);assert.equal(failed.retryAfter,scenario.retryAfter);
 assert.equal(sent.options.headers['X-FormRelay-Key'],key);assert.deepEqual(JSON.parse(sent.options.body),{fields:definitions});
 assert.equal(reply.error.includes(key),false);assert.equal(session['formrelay.tab.1'],undefined);
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
 session['formrelay.tab.1'].request={id:'a'.repeat(32),token:'private-owner',base:'http://localhost:3000',url:'http://localhost:3000/r/'+'a'.repeat(32),sourceOrigin:'https://one.example',sourcePath:'/form',expiresAt:Date.now()+60000,fields};
 delete session['formrelay.tab.1'].requests; // Simulate a session written by the previous single-request release.
 worker=load();const restored=await worker.call({action:'INIT',documentToken:'b'},{...sender,documentId:'doc-b'});assert.equal(restored.request.token,'private-owner');assert.equal(session['formrelay.tab.1'].view,null);
 assert.equal((await worker.call({action:'STATE_UPDATE',documentToken:'a',state:{status:'stale'}},sender)).ok,false);
 assert.equal((await worker.call({action:'INIT',documentToken:'two'},{id:'trusted',tab:tabs[2],url:tabs[2].url,documentId:'two'})).request,null);
 const publicState=await worker.call({action:'GET_TAB_STATE',tabId:1});assert.equal(publicState.request.token,undefined);
 tabs[1].url='https://another.example/form';assert.equal((await worker.call({action:'GET_TAB_STATE',tabId:1})).request,null);
 worker.removed(1);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(session['formrelay.tab.1'].requests['a'.repeat(32)].view.phase,'unavailable');
});

test('worker retains multiple request IDs, credentials and history across drafts, restart, navigation and tab closure',async()=>{
 const session={};let count=0,prepared=fields;const tabs={1:{id:1,url:'http://localhost:3108/demo'}};
 function load(){let listener,removed,updated;const chrome={runtime:{id:'trusted',onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async name=>name===null?session:{[name]:session[name]},set:async data=>Object.assign(session,data),remove:async name=>{delete session[name]}}},tabs:{get:async id=>tabs[id],sendMessage:async(id,msg)=>msg.action==='PREPARE_REQUEST'?{ok:true,documentToken:'doc',fields:prepared}:{ok:true},onRemoved:{addListener:fn=>removed=fn},onUpdated:{addListener:fn=>updated=fn}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../extension/background.js'),'utf8'),{URL,Error,Date,chrome,fetch:async()=>({ok:true,status:201,json:async()=>({id:String(++count).repeat(32),ownerToken:'owner-'+count,url:'http://localhost:3108/r/'+String(count).repeat(32),expiresAt:Date.now()+60000})})});
 return {call:(msg,sender={id:'trusted'})=>new Promise(resolve=>listener(msg,sender,resolve)),removed,updated};}
 let worker=load();const create=()=>worker.call({action:'CREATE_REQUEST',tabId:1,base:'http://localhost:3108'});
 const a=await create();assert.equal(a.ok,true);assert.equal((await worker.call({action:'CLEAR_REQUEST',tabId:1})).ok,true);
 prepared=[{key:'occupation',label:'Occupation',type:'text'}];const b=await create();assert.equal(b.ok,true);assert.notEqual(a.request.id,b.request.id);
 worker=load();const restored=await worker.call({action:'INIT',documentToken:'next'},{id:'trusted',tab:tabs[1],url:tabs[1].url,documentId:'next'});
 assert.equal(restored.requests.length,2);assert.deepEqual(Array.from(restored.requests,r=>r.token),['owner-1','owner-2']);
 const history=await worker.call({action:'GET_REQUESTS'});assert.equal(history.requests.length,2);assert.equal(JSON.stringify(history).includes('owner-'),false);
 tabs[1].url+='?different-step=1';worker.updated(1,{status:'loading'});await new Promise(resolve=>setTimeout(resolve,0));
 const foreign=await worker.call({action:'INIT',documentToken:'other'},{id:'trusted',tab:tabs[1],url:tabs[1].url,documentId:'other'});assert.equal(foreign.requests.length,0);
 assert.equal((await worker.call({action:'GET_REQUESTS'})).requests.every(r=>r.phase==='unavailable'),true);
 worker.removed(1);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(Object.keys(session['formrelay.tab.1'].requests).length,2);
 assert.equal((await worker.call({action:'STATE_UPDATE',documentToken:'next',state:{requests:[]}}, {id:'trusted',tab:tabs[1],url:tabs[1].url})).ok,false);
 session['formrelay.tab.1'].requests[a.request.id].expiresAt=Date.now()-1;assert.equal((await worker.call({action:'GET_REQUESTS'})).requests.find(r=>r.id===a.request.id).phase,'expired');
});

test('backend independently accepts B before A while enforcing each owner token and field schema',async()=>{
 const s=await launch();try{
 const a=await (await s.create()).json();
 const b=await (await s.request('/api/requests',{method:'POST',headers:{'X-FormRelay-Key':key},body:JSON.stringify({fields:[{key:'occupation',label:'Occupation',type:'text'}]})})).json();
 const submit=(r,answers)=>s.request('/api/requests/'+r.id+'/answer',{method:'POST',body:JSON.stringify({answers})});
 assert.equal((await submit(b,{guardian:'Wrong schema'})).status,400);
 assert.equal((await submit(b,{occupation:'Fictional Teacher'})).status,200);
 assert.equal((await s.request('/api/requests/'+b.id+'/status',{headers:{Authorization:'Bearer '+a.ownerToken}})).status,403);
 assert.equal((await (await s.request('/api/requests/'+a.id+'/status',{headers:{Authorization:'Bearer '+a.ownerToken}})).json()).submitted,false);
 assert.equal((await submit(a,{guardian:'Morgan Example'})).status,200);
 for(const [r,expected] of [[a,{guardian:'Morgan Example'}],[b,{occupation:'Fictional Teacher'}]])assert.deepEqual((await (await s.request('/api/requests/'+r.id+'/status',{headers:{Authorization:'Bearer '+r.ownerToken}})).json()).answers,expected);
 }finally{await s.stop()}
});

test('Other answers require exactly the selected custom texts, preserve checkbox choices, and accept full questions',()=>{
 const {definitions,validateAnswers}=require('../fields');
 const fields=definitions([{key:'question',label:'Which fictional subject interests you? '+ 'Please explain the additional subject in your own words. '.repeat(3),type:'checkbox-group',options:[{value:'math',label:'Mathematics'},{value:'plain',label:'Other'},{value:'custom',label:'Other (specify)',other:true,existingAnswer:'Never expose'}]}]);
 assert.equal(fields[0].label.length>100,true);assert.equal(JSON.stringify(fields).includes('Never expose'),false);
 const valid={question:{value:['math','custom'],other:{custom:'Fictional Robotics'}}};assert.deepEqual(JSON.parse(JSON.stringify(validateAnswers(fields,valid))),valid);
 for(const question of [['custom'],{value:['custom'],other:{}},{value:['math'],other:{custom:'Not selected'}},{value:['custom'],other:{custom:''}},{value:['custom'],other:{custom:'x'.repeat(501)}},{value:['custom'],other:{unknown:'Wrong identity'}},{value:['custom'],other:{custom:'Text'},extra:'Unexpected'}])assert.throws(()=>validateAnswers(fields,{question}));
 assert.deepEqual(validateAnswers(fields,{question:['plain']}).question,['plain']);
 const radio=definitions([{key:'radio',label:'Which destination?',type:'radio',options:[{value:'custom',label:'Other',other:true}]}]);assert.throws(()=>validateAnswers(radio,{radio:'custom'}));assert.equal(validateAnswers(radio,{radio:{value:'custom',other:{custom:'Fictional City'}}}).radio.other.custom,'Fictional City');
});
