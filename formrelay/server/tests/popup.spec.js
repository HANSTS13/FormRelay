const {test,expect}=require('@playwright/test');const fs=require('fs');const path=require('path');
const directory=path.join(__dirname,'../../extension');
async function popup(context,store){
 await context.exposeBinding('formrelayTestAPI',(_,kind,args)=>{
  if(kind==='query')return [{id:store.active,url:'https://site'+store.active+'.example/form'}];
  if(kind==='getLocal')return {formrelayBase:'http://localhost:3000'};
  if(kind==='getSession')return {};
  if(kind==='content'){
   const [id,msg]=args;const state=store.tabs[id];
   if(msg.action==='PING')return {ok:true,version:'0.4.0'};
   if(msg.action==='GET_STATE')return {...state,ok:true};
   if(msg.action==='START'){state.selecting=true;state.status='Selection mode active.';return {ok:true}}
   if(msg.action==='REMOVE_FIELD'){state.selection=state.selection.filter(f=>f.key!==msg.key);return {ok:true}}
   if(msg.action==='CLEAR'||msg.action==='NEW_REQUEST'){state.selection=[];state.request=null;return {ok:true}}
   if(msg.action==='STOP'){state.selecting=false;return {ok:true}}
   if(msg.action==='CHECK')return {fields:[],selected:[],limitations:'Native controls only.'};
   return {ok:true};
  }
  if(kind==='worker'){
   const [msg]=args;if(msg.action==='TEST_CONNECTION')return store.offline?{ok:false,error:'Backend unavailable. Start FormRelay and retry.'}:{ok:true,data:{ok:true}};
   if(msg.action==='CREATE_REQUEST'){const state=store.tabs[msg.tabId];state.request={id:'a'.repeat(32),base:msg.base,url:msg.base+'/r/'+'a'.repeat(32),expiresAt:Date.now()+1800000,phase:'waiting',fields:state.selection,results:[]};state.selection=[];return {ok:true,request:state.request}}
   return {ok:true};
  }
  return {};
 });
 await context.addInitScript(()=>{window.chrome={storage:{local:{get:async()=>formrelayTestAPI('getLocal'),set:async()=>{}},session:{get:async()=>formrelayTestAPI('getSession'),set:async()=>{}},onChanged:{addListener:()=>{}}},tabs:{query:async()=>formrelayTestAPI('query'),sendMessage:async(...args)=>formrelayTestAPI('content',args),onActivated:{addListener:()=>{}},onUpdated:{addListener:()=>{}}},scripting:{executeScript:async()=>{}},runtime:{sendMessage:async(...args)=>formrelayTestAPI('worker',args)}}});
 await context.route('**/__popup/*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(path.join(directory,name))})});
 return async()=>{const page=await context.newPage();await page.goto('http://localhost:3108/__popup/popup.html');await expect(page.locator('#website')).toContainText('site'+store.active+'.example');return page};
}
const state=()=>({selection:[{key:'name',label:'Guardian name',type:'text'}],selecting:false,status:'',request:null});
test('popup reopen, tab isolation, removal, clear and persistent request presentation',async({context},testInfo)=>{
 const store={active:1,tabs:{1:state(),2:{...state(),selection:[]}}};const open=await popup(context,store);let page=await open();await expect(page.locator('#selection-count')).toHaveText('1 selected');await page.setViewportSize({width:392,height:600});await page.screenshot({path:testInfo.outputPath('popup-fields.png')});await page.close();
 page=await open();await expect(page.locator('#selection-count')).toHaveText('1 selected');await page.close();store.active=2;
 page=await open();await expect(page.locator('#selection-count')).toHaveText('0 selected');await expect(page.locator('#empty-fields')).toBeVisible();await page.close();store.active=1;
 page=await open();await page.getByRole('button',{name:'Create request',exact:true}).click();await expect(page.locator('#request-status')).toHaveText('Waiting for response');await expect(page.locator('#link')).toHaveValue(/\/r\/[a-f0-9]{32}$/);await page.close();
 page=await open();await page.getByRole('tab',{name:/Requests/}).click();await expect(page.locator('#link')).toHaveValue(/\/r\/[a-f0-9]{32}$/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('popup keyboard tabs, settings privacy, backend errors and clear selection',async({context})=>{
 const store={active:1,tabs:{1:state()},offline:true};const open=await popup(context,store);const page=await open();
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();await expect(page.locator('#selection-count')).toHaveText('0 selected');
 await page.getByRole('tab',{name:/Fields/}).focus();await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'Settings'})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#accessKey')).toHaveAttribute('type','password');await page.getByRole('button',{name:'Save & test connection'}).click();await expect(page.locator('#message')).toContainText('Backend unavailable');
});
