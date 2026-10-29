
const {test,expect}=require('@playwright/test');
const path=require('path');
test('health, demo, owner isolation and validation',async({request})=>{
 expect((await request.get('/health')).status()).toBe(200);
 expect((await request.get('/demo')).status()).toBe(200);
 for(const fields of [[null],[{key:'p',label:'Password',type:'text'}],[{key:'h',label:'Hidden',type:'hidden'}]])expect((await request.post('/api/requests',{data:{fields}})).status()).toBe(400);
 const created=await request.post('/api/requests',{data:{fields:[{key:'phone',label:'Guardian phone',type:'tel',value:'NEVER SHARE'}]}});
 expect(created.status()).toBe(201);const r=await created.json();
 expect(JSON.stringify(await (await request.get('/api/requests/'+r.id+'/fields')).json())).not.toContain('NEVER SHARE');
 expect((await request.get('/api/requests/'+r.id+'/status')).status()).toBe(403);
 expect((await request.get('/api/requests/'+r.id+'/status',{headers:{Authorization:'Bearer wrong'}})).status()).toBe(403);
 expect((await request.get('/api/requests/'+r.id+'/qr.png')).headers()['content-type']).toContain('image/png');
 expect((await request.post('/api/requests/'+r.id+'/answer',{data:{answers:{phone:'bad'}}})).status()).toBe(400);
 expect((await request.post('/api/requests/'+r.id+'/answer',{data:{answers:{phone:'555-0100',extra:'x'}}})).status()).toBe(400);
 expect((await request.post('/api/requests/'+r.id+'/answer',{data:{answers:{phone:'555-0100'}}})).status()).toBe(200);
 expect((await request.post('/api/requests/'+r.id+'/answer',{data:{answers:{phone:'555-0100'}}})).status()).toBe(409);
 const other=await (await request.post('/api/requests',{data:{fields:[{key:'x',label:'Name',type:'text'}]}})).json();
 expect((await request.get('/api/requests/'+r.id+'/status',{headers:{Authorization:'Bearer '+other.ownerToken}})).status()).toBe(403);
 expect((await request.get('/api/requests/'+r.id+'/status',{headers:{Authorization:'Bearer '+r.ownerToken}})).status()).toBe(200);
});
test('two tabs: real content and recipient scripts using a simulated Chrome messaging bridge',async({page,context,request})=>{
 await page.goto('/demo');
 await page.evaluate(()=>{
 window.changes=[];window.submissions=0;
 document.addEventListener('input',e=>changes.push('input:'+e.target.id));document.addEventListener('change',e=>changes.push('change:'+e.target.id));
 document.querySelector('form').addEventListener('submit',()=>submissions++);
 window.chrome={storage:{local:{set:()=>{}}},runtime:{lastError:null,onMessage:{addListener:fn=>window.receive=fn},sendMessage:async(msg,cb)=>{const r=await fetch(msg.path,{headers:{Authorization:'Bearer '+msg.token}});cb({ok:r.ok,data:await r.json()})}}};
 });
 await page.addScriptTag({path:path.join(__dirname,'../../extension/content.js')});
 await page.evaluate(()=>receive({action:'START'},null,()=>{}));
 for(const id of ['guardian_name','guardian_job','guardian_phone'])await page.locator('#'+id).click();
 await page.locator('#guardian_job').click();await page.locator('#guardian_job').click();
 await page.evaluate(()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(await page.evaluate(()=>submissions)).toBe(0);
 const fields=await page.evaluate(()=>new Promise(resolve=>receive({action:'GET_SELECTION'},null,r=>resolve(r.fields))));expect(fields).toHaveLength(3);
 expect(JSON.stringify(fields)).not.toContain('Demo Student');
 const r=await (await request.post('/api/requests',{data:{fields}})).json();
 await page.evaluate(r=>receive({action:'TRACK',track:{base:location.origin,id:r.id,token:r.ownerToken}},null,()=>{}),r);
 const recipient=await context.newPage();await recipient.goto(r.url);
 await recipient.getByLabel('Guardian Full Name').fill('Morgan Example');await recipient.getByLabel('Guardian Occupation').fill('Fictional Teacher');await recipient.getByLabel('Guardian Phone').fill('555-0100');await recipient.getByRole('button',{name:'Send answers'}).click();
 await expect(recipient.locator('#status')).toContainText('Submitted!');
 await expect(page.locator('#guardian_name')).toHaveValue('Morgan Example');await expect(page.locator('#guardian_job')).toHaveValue('Fictional Teacher');await expect(page.locator('#guardian_phone')).toHaveValue('555-0100');
 await expect(page.locator('#student_name')).toHaveValue('Demo Student');await expect(page.locator('#family_income')).toHaveValue('');
 expect(await page.evaluate(()=>changes.length)).toBe(6);expect(await page.evaluate(()=>submissions)).toBe(0);
 await expect(page.locator('#guardian_name')).toHaveCSS('background-color','rgb(216, 248, 230)');
});
