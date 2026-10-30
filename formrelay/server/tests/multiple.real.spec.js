const {test,expect,chromium}=require('@playwright/test');
const path=require('node:path');
const {createApp}=require('../index');

test('real MV3: pending A and B survive popup/worker restart, fill B then A, and retain unavailable history',async()=>{
 test.setTimeout(100000);
 // A separate real backend keeps this test independent of other tests' rate-limit budget.
 const app=createApp({NODE_ENV:'development'});
 const server=await new Promise(resolve=>{const s=app.app.listen(0,'127.0.0.1',()=>resolve(s))});
 const base='http://localhost:'+server.address().port;
 const extension=path.resolve(__dirname,'../../extension');let context;
 try{
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=worker.url().split('/')[2];
  const original=await context.newPage();await original.addInitScript(()=>{window.originalSubmits=0;document.addEventListener('submit',()=>originalSubmits++)});await original.goto(base+'/demo');
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/demo');
  const state=()=>worker.evaluate(id=>chrome.tabs.sendMessage(id,{action:'GET_STATE'}),tabId);
  async function popup(id=tabId){await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),id);const created=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));const p=await created;await p.waitForLoadState();await expect(p.locator('#connection')).toHaveText('Connected to this page');return p}
  let p=await popup();await p.getByRole('tab',{name:'Settings'}).click();await p.locator('#base').fill(base);await p.getByRole('button',{name:'Save & test connection'}).click();await expect(p.locator('#settings-status')).toContainText('Backend connected');await p.close();
  async function create(field,isNew){let p=await popup();if(isNew){await p.getByRole('tab',{name:/Requests/}).click();await p.getByRole('button',{name:'New request',exact:true}).click()}await p.getByRole('button',{name:'Start selection'}).click();await p.close();await original.locator(field).click();p=await popup();await p.getByRole('button',{name:'Finish selection'}).click();const previousLink=await p.locator('#link').inputValue();await p.getByRole('button',{name:'Create request',exact:true}).click();await expect(p.locator('#link')).not.toHaveValue(previousLink);await expect(p.locator('#request-status')).toHaveText('Pending');await expect.poll(()=>p.locator('#qr').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);const url=await p.locator('#link').inputValue();await p.close();return url}
  const a=await create('#guardian_name',false);const b=await create('#guardian_job',true);expect(a).not.toBe(b);
  p=await popup();await p.getByRole('tab',{name:/Requests/}).click();await expect(p.locator('#request-picker option')).toHaveCount(2);await p.locator('#request-picker').selectOption(a.split('/').pop());await expect(p.locator('#link')).toHaveValue(a);await p.close();
  // Stop only this isolated test profile's worker, then wake it normally.
  await worker.evaluate(()=>globalThis.__pendingRestartProof=true);
  const diagnostic=await context.newPage();await diagnostic.goto('chrome://serviceworker-internals/');await expect(diagnostic.getByRole('button',{name:'Stop',exact:true})).toHaveCount(1);await diagnostic.getByRole('button',{name:'Stop',exact:true}).click();await expect(diagnostic.locator('body')).toContainText('Running Status: STOPPED');
  const wake=await context.newPage();await wake.goto('chrome-extension://'+extensionId+'/popup.html');expect((await wake.evaluate(base=>chrome.runtime.sendMessage({action:'TEST_CONNECTION',base}),base)).ok).toBe(true);expect(await worker.evaluate(()=>globalThis.__pendingRestartProof)).toBeUndefined();await wake.close();await diagnostic.close();
  expect((await state()).requests).toHaveLength(2);
  const recipient=await context.newPage();await recipient.goto(b);await recipient.getByLabel('Guardian Occupation').fill('Fictional Teacher');await recipient.getByRole('button',{name:'Send answers'}).click();await expect(original.locator('#guardian_job')).toHaveValue('Fictional Teacher');await expect(original.locator('#guardian_name')).toHaveValue('');
  await recipient.goto(a);await recipient.getByLabel('Guardian Full Name').fill('Morgan Example');await recipient.getByRole('button',{name:'Send answers'}).click();await expect(original.locator('#guardian_name')).toHaveValue('Morgan Example');await expect(original.locator('#guardian_job')).toHaveValue('Fictional Teacher');await expect.poll(async()=>(await state()).requests.every(r=>r.phase==='completed')).toBe(true);
  await expect(original.locator('#student_name')).toHaveValue('Demo Student');await expect(original.locator('#guardian_phone')).toHaveValue('');expect(await original.evaluate(()=>originalSubmits)).toBe(0);
  // A second source tab has its own draft and cannot undo/confirm the first tab's mappings.
  const other=await context.newPage();await other.goto(base+'/demo?other=1');const otherId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/demo?other=1');p=await popup(otherId);await expect(p.locator('#selection-count')).toHaveText('0 selected');await p.getByRole('tab',{name:/Requests/}).click();await p.locator('#request-picker').selectOption(a.split('/').pop());await expect(p.locator('#link')).toHaveValue(a);await expect(p.locator('#undo')).toBeDisabled();await p.close();await expect(other.locator('#guardian_name')).toHaveValue('');
  const c=await create('#guardian_phone',true);await original.goto(base+'/demo?different-step=1');p=await popup();await p.getByRole('tab',{name:/Requests/}).click();await p.locator('#request-picker').selectOption(c.split('/').pop());await expect(p.locator('#request-status')).toHaveText('Original Form Unavailable');await p.close();
  await recipient.goto(c);await recipient.getByLabel('Guardian Phone').fill('2025550142');await recipient.getByRole('button',{name:'Send answers'}).click();await expect(original.locator('#guardian_phone')).toHaveValue('');
  await original.close();p=await popup(otherId);await p.getByRole('tab',{name:/Requests/}).click();await p.locator('#request-picker').selectOption(c.split('/').pop());await expect(p.locator('#request-status')).toHaveText('Original Form Unavailable');await expect(p.locator('#link')).toHaveValue(c);await expect(other.locator('#guardian_phone')).toHaveValue('');await p.close();
 }finally{if(context)await context.close();await new Promise(resolve=>server.close(resolve));app.close()}
});
