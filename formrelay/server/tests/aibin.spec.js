const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const express=require('express');

test('aibin legacy dropdown contribution creates choices, renders the recipient and autofills the original select',async({page,context})=>{
 const root=path.resolve(__dirname,'../../..'),directory=path.join(root,'server');
 const app=express(),listen=app.listen.bind(app),timers=[];let server;
 // Execute the actual legacy server on an isolated random loopback port.
 app.listen=(_port,_host,callback)=>server=listen(0,'127.0.0.1',callback);
 const wrappedExpress=Object.assign(()=>app,express);
 vm.runInNewContext(fs.readFileSync(path.join(directory,'index.js'),'utf8'),{require:id=>id==='express'?wrappedExpress:require(id),__dirname:directory,Buffer,process:{env:{PORT:'0'}},console:{log:()=>{}},setInterval:(...args)=>{const timer=setInterval(...args);timers.push(timer);return timer}});
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;let recipient;
 try{
  await page.goto(base+'/demo');await page.evaluate(()=>{window.selected=[];window.originalSubmits=0;document.addEventListener('submit',()=>originalSubmits++);window.chrome={storage:{local:{set:data=>{if(data.formrelaySelected)selected=data.formrelaySelected}}},runtime:{onMessage:{addListener:fn=>window.receive=fn},sendMessage:async(msg,callback)=>{const r=await fetch(msg.base+msg.path,{headers:{Authorization:'Bearer '+msg.token}});callback({ok:r.ok,status:r.status,data:await r.json()})}}}});
  await page.route('**/__test/aibin-content.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'extension/content.js'),'utf8')}));await page.addScriptTag({url:base+'/__test/aibin-content.js'});
  await page.evaluate(()=>receive({action:'START'},null,()=>{}));await page.locator('#guardian_relationship').click();
  const fields=await page.evaluate(()=>selected);expect(fields).toHaveLength(1);expect(fields[0].type).toBe('select');expect(fields[0].options.map(o=>o.value)).toEqual(['Mother','Father','Legal Guardian','Grandparent','Other']);
  const response=await page.request.post(base+'/api/requests',{data:{fields}});expect(response.status()).toBe(201);const request=await response.json();
  expect((await page.request.get(base+'/api/requests/'+request.id+'/qr.png')).status()).toBe(200);expect((await page.request.get(base+'/api/requests/'+request.id+'/status')).status()).toBe(403);
  await page.evaluate(({request,base})=>receive({action:'TRACK',track:{id:request.id,token:request.ownerToken,base}},null,()=>{}),{request,base});
  recipient=await context.newPage();await recipient.goto(request.url);await expect(recipient.locator('select option')).toHaveCount(6);await recipient.locator('select').selectOption('Mother');await recipient.getByRole('button',{name:'Send answers'}).click();await expect(page.locator('#guardian_relationship')).toHaveValue('Mother');await expect(page.locator('#student_name')).toHaveValue('Demo Student');await expect(page.locator('#guardian_name')).toHaveValue('');expect(await page.evaluate(()=>originalSubmits)).toBe(0);
  await page.evaluate(()=>receive({action:'UNDO'},null,()=>{}));await expect(page.locator('#guardian_relationship')).toHaveValue('');
 }finally{if(recipient)await recipient.close();await page.close();for(const timer of timers)clearInterval(timer);await new Promise(resolve=>server.close(resolve))}
});
