const {test, expect}=require('@playwright/test');
const fs=require('fs');const path=require('path');
async function setup(page){
 await page.goto('/demo');await page.evaluate(()=>{window.chrome={storage:{local:{set:()=>{}}},runtime:{onMessage:{addListener:fn=>window.receive=fn},sendMessage:(msg,cb)=>cb?.({ok:true})}}});
 await page.route('**/__test/reliability.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'../../extension/content.js'),'utf8')}));
 await page.addScriptTag({url:'/__test/reliability.js'});
}
const command=(page,action,extra={})=>page.evaluate(({action,extra})=>new Promise(resolve=>receive({action,...extra},null,resolve)),{action,extra});
test('regression: popup reads do not clear selections and reinjection does not duplicate handlers',async({page})=>{
 await setup(page);await command(page,'START');await page.locator('#guardian_name').click();
 expect((await command(page,'GET_SELECTION')).fields).toHaveLength(1);expect((await command(page,'GET_SELECTION')).fields).toHaveLength(1);
 await page.addScriptTag({url:'/__test/reliability.js'});await page.locator('#guardian_name').click();expect((await command(page,'GET_SELECTION')).fields).toHaveLength(0);
});
test('regression: clearing and starting a new request restore styling and remove only intended state',async({page})=>{
 await setup(page);await command(page,'START');await page.locator('#guardian_name').click();await page.locator('#guardian_job').click();
 expect((await command(page,'REMOVE_FIELD',{key:(await command(page,'GET_SELECTION')).fields[0].key})).ok).toBe(true);
 expect((await command(page,'GET_SELECTION')).fields).toHaveLength(1);
 expect((await command(page,'CLEAR')).ok).toBe(true);expect((await command(page,'GET_SELECTION')).fields).toHaveLength(0);
 await expect(page.locator('#guardian_name')).not.toHaveCSS('outline-color','rgb(21, 146, 96)');
 expect((await command(page,'GET_STATE')).selection).toHaveLength(0);
});

test('request preparation locks mappings and public state never exposes owner tokens',async({page})=>{
 await setup(page);await command(page,'START');await page.locator('#guardian_name').click();const prepared=await command(page,'PREPARE_REQUEST');expect(prepared.ok).toBe(true);expect((await command(page,'START')).ok).toBe(false);await command(page,'CREATE_FAILED');expect((await command(page,'GET_SELECTION')).fields).toHaveLength(1);
 await command(page,'TRACK',{track:{id:'a'.repeat(32),base:'http://localhost:3000',token:'private-owner',expiresAt:Date.now()+60000}});
 const state=await command(page,'GET_STATE');expect(state.selection).toHaveLength(0);expect(state.request.fields).toHaveLength(1);expect(state.request.token).toBeUndefined();expect((await command(page,'NEW_REQUEST')).ok).toBe(false);
});
test('expired requests unlock a fresh request without extension reload',async({page})=>{
 await setup(page);await page.evaluate(()=>{const Base=MutationObserver;window.activeObservers=0;window.MutationObserver=class extends Base{observe(...args){if(!this.tracked){this.tracked=true;activeObservers++}super.observe(...args)}disconnect(){if(this.tracked){this.tracked=false;activeObservers--}super.disconnect()}}});await command(page,'START');await page.locator('#guardian_name').click();await command(page,'TRACK',{track:{id:'a'.repeat(32),base:'http://localhost:3000',token:'owner',expiresAt:Date.now()-1}});
 expect((await command(page,'GET_STATE')).request.phase).toBe('expired');expect(await page.evaluate(()=>activeObservers)).toBe(0);expect((await command(page,'NEW_REQUEST')).ok).toBe(true);await command(page,'START');await page.locator('#guardian_job').click();expect((await command(page,'GET_SELECTION')).fields.map(f=>f.label)).toEqual(['Guardian Occupation']);
});
test('invalidated content context cleans handlers and can be reinjected safely',async({page})=>{
 await setup(page);await page.evaluate(()=>{chrome.runtime.sendMessage=()=>{throw Error('Extension context invalidated')};chrome.runtime.onMessage.removeListener=()=>{throw Error('Extension context invalidated')}});await command(page,'START');expect(await page.evaluate(()=>__formrelayInstance.alive)).toBe(false);
 await page.evaluate(()=>{chrome.runtime.sendMessage=(msg,cb)=>cb?.({ok:true});chrome.runtime.onMessage.removeListener=()=>{}});await page.addScriptTag({url:'/__test/reliability.js'});expect((await command(page,'START')).ok).toBe(true);await page.locator('#guardian_name').click();expect((await command(page,'GET_SELECTION')).fields).toHaveLength(1);
});
test('late responses from an older request cannot finish or fill a new request',async({page})=>{
 await setup(page);await page.evaluate(()=>{window.pending=[];chrome.runtime.sendMessage=(msg,cb)=>{if(msg.action==='FETCH')pending.push(cb);else cb?.({ok:true})}});
 await command(page,'START');await page.locator('#guardian_name').click();const old=(await command(page,'GET_SELECTION')).fields[0];await command(page,'TRACK',{track:{id:'a'.repeat(32),base:'http://localhost:3000',token:'old',expiresAt:Date.now()+100}});
 await page.waitForTimeout(130);await command(page,'NEW_REQUEST');await command(page,'START');await page.locator('#guardian_job').click();await command(page,'TRACK',{track:{id:'b'.repeat(32),base:'http://localhost:3000',token:'new',expiresAt:Date.now()+60000}});
 await page.evaluate(key=>pending[0]({ok:true,data:{submitted:true,answers:{[key]:'Must not leak'}}}),old.key);
 expect((await command(page,'GET_STATE')).request.id).toBe('b'.repeat(32));expect((await command(page,'GET_STATE')).request.phase).toBe('waiting');await expect(page.locator('#guardian_name')).toHaveValue('');await expect(page.locator('#guardian_job')).toHaveValue('');
});
