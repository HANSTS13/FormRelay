const {test,expect,chromium}=require('@playwright/test');
const path=require('path');
test('real MV3 extension: popup reopen, tab isolation, consecutive requests, worker restart and navigation recovery',async({},testInfo)=>{
 test.setTimeout(100000);
 const extension=path.resolve(__dirname,'../../extension');
 const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 try{
  let background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=background.url().split('/')[2];
  const page=await context.newPage();await page.addInitScript(()=>{window.originalSubmits=0;document.addEventListener('submit',()=>originalSubmits++)});await page.goto('http://localhost:3108/demo');
  const original=await background.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(tab=>tab.url==='http://localhost:3108/demo').id});
  const bg=async()=>background;
  const state=async()=>{const worker=await bg();return worker.evaluate(id=>chrome.tabs.sendMessage(id,{action:'GET_STATE'}),original)};
  async function openPopup(active=original){
   const worker=await bg();await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),active);
   const promise=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));const popup=await promise;await popup.waitForLoadState();await expect(popup.locator('#connection')).toHaveText('Connected to this page');return popup;
  }
  let popup=await openPopup();await popup.getByRole('tab',{name:'Settings'}).click();await popup.locator('#base').fill('http://localhost:3108');await popup.getByRole('button',{name:'Save & test connection'}).click();await expect(popup.locator('#settings-status')).toContainText('Backend connected successfully');
  await popup.getByRole('tab',{name:/Fields/}).click();await popup.getByRole('button',{name:'Start selection'}).click();await popup.close();await page.locator('#guardian_name').click();await page.locator('#guardian_relationship').click();
  popup=await openPopup();await expect(popup.locator('#selection-count')).toHaveText('2 selected');await popup.getByRole('button',{name:'Finish selection'}).click();await popup.getByRole('button',{name:'Create request',exact:true}).click();await expect(popup.locator('#request-status')).toHaveText('Pending');await expect.poll(()=>popup.locator('#qr').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);const link=await popup.locator('#link').inputValue();await popup.close();
  popup=await openPopup();await popup.getByRole('tab',{name:/Requests/}).click();await expect(popup.locator('#link')).toHaveValue(link);await popup.setViewportSize({width:392,height:600});await popup.screenshot({path:testInfo.outputPath('real-popup-request.png')});await popup.close();
  const recipient=await context.newPage();await recipient.goto(link);await expect(recipient.getByRole('region',{name:'AI Assistance'})).toBeVisible();await recipient.getByLabel('Guardian Full Name').fill('Morgan Example');await recipient.getByLabel('Guardian Relationship',{exact:true}).selectOption({label:'Mother'});await recipient.getByRole('button',{name:'Send answers'}).click();await expect(page.locator('#guardian_name')).toHaveValue('Morgan Example');await expect(page.locator('#guardian_relationship')).toHaveValue('Mother');await expect.poll(async()=>(await state()).request.phase).toBe('completed');
  await expect(page.locator('#student_name')).toHaveValue('Demo Student');await expect(page.locator('#family_income')).toHaveValue('');
  const recipientId=await (await bg()).evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(tab=>/\/r\//.test(tab.url)).id});popup=await openPopup(recipientId);await expect(popup.locator('#selection-count')).toHaveText('0 selected');await expect(popup.locator('#request-card')).toBeHidden();await popup.close();
  popup=await openPopup();await popup.getByRole('tab',{name:/Requests/}).click();await popup.getByRole('button',{name:'New request',exact:true}).click();await popup.getByRole('button',{name:'Start selection'}).click();await popup.close();await page.locator('#guardian_job').click();
  popup=await openPopup();await expect(popup.locator('#selection-count')).toHaveText('1 selected');await popup.getByRole('button',{name:'Finish selection'}).click();await popup.getByRole('button',{name:'Create request',exact:true}).click();await expect(popup.locator('#request-status')).toHaveText('Pending');const second=await popup.locator('#link').inputValue();expect(second).not.toBe(link);await popup.close();
  const beforeWorker=await bg();await beforeWorker.evaluate(()=>globalThis.__lifecycleProof='before-stop');
  const diagnostic=await context.newPage();await diagnostic.goto('chrome://serviceworker-internals/');await expect(diagnostic.locator('body')).toContainText('chrome-extension://'+extensionId+'/');await expect(diagnostic.getByRole('button',{name:'Stop',exact:true})).toHaveCount(1);
  await diagnostic.getByRole('button',{name:'Stop',exact:true}).click();await expect(diagnostic.locator('body')).toContainText('Running Status: STOPPED');
  const wake=await context.newPage();await wake.goto('chrome-extension://'+extensionId+'/popup.html');expect((await wake.evaluate(()=>chrome.runtime.sendMessage({action:'TEST_CONNECTION',base:'http://localhost:3108'}))).ok).toBe(true);
  expect(await beforeWorker.evaluate(()=>globalThis.__lifecycleProof)).toBeUndefined();await expect(diagnostic.locator('body')).toContainText('Running Status: RUNNING');await wake.close();await diagnostic.close();
  // An ordinary extension message wakes its registered worker; no extension reload.
  await page.waitForTimeout(300);await page.reload();popup=await openPopup();await popup.getByRole('tab',{name:/Requests/}).click();await expect(popup.locator('#link')).toHaveValue(second);await popup.close();
  await recipient.goto(second);await recipient.getByLabel('Guardian Occupation').fill('Fictional Teacher');await recipient.getByRole('button',{name:'Send answers'}).click();
  await expect.poll(async()=>(await state()).request.results[0].state).toBe('confirmation');await expect(page.locator('#guardian_job')).toHaveValue('');
  popup=await openPopup();await popup.getByRole('tab',{name:/Requests/}).click();await popup.getByRole('button',{name:'Confirm replacement for Guardian Occupation'}).click();await popup.close();await page.locator('#guardian_job').click();await expect(page.locator('#guardian_job')).toHaveValue('Fictional Teacher');await expect.poll(async()=>(await state()).request.phase).toBe('completed');
  expect(await page.evaluate(()=>originalSubmits)).toBe(0);
 }finally{await context.close()}
});
