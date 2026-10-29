chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
 if(msg.action!=='FETCH')return;
 (async()=>{try{const base=new URL(msg.base);if(!((base.protocol==='http:'&&base.hostname==='localhost'&&base.port==='3000')||(base.protocol==='https:'&&base.hostname.endsWith('.onrender.com'))))throw Error('Only localhost:3000 or *.onrender.com is allowed');const path=msg.path;if(!/^\/api\/requests\/[a-f0-9]{32}\/status$/.test(path))throw Error('Invalid API path');const r=await fetch(base.origin+path,{headers:{Authorization:`Bearer ${msg.token}`}});sendResponse({ok:r.ok,data:await r.json()})}catch(e){sendResponse({ok:false,error:e.message})}})();return true;
});
