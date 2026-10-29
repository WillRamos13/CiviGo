/* eslint-disable @typescript-eslint/no-require-imports */
// Real Chromium and React against local HTTP fixtures. Never submits a payment
// or contacts Mercado Pago. The final external navigation is deliberately stopped.
const {app,server,windows,createClient,waitUntil,delay,errors}=require('./map-live-smoke.cjs');
const assert=require('node:assert/strict'),{once}=require('node:events'),fs=require('node:fs/promises'),path=require('node:path');
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const out=path.resolve(__dirname,'../.local/home-payment-oct28'),attempts=[];
let emailFlow=false,emailVerified=false;
const original=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(emailFlow&&url.pathname==='/api/users/me')return res.end(JSON.stringify({usuario:{id:901,nickname:'Usuario fixture',correo:'fixture@gmail.com',rol:'USUARIO',correoVerificado:emailVerified,premium:false}}));
 if(url.pathname==='/api/users/email/google/config')return res.end(JSON.stringify({configurado:false,projectId:null}));
 if(url.pathname==='/api/users/email/code/request'){req.resume();return res.end(JSON.stringify({challengeId:'123',resendAfterSeconds:60}));}
 if(url.pathname==='/api/users/email/code/confirm'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{if(JSON.parse(body).codigo!=='123456'){res.statusCode=400;return res.end(JSON.stringify({error:'Código incorrecto. Revisa los seis dígitos del correo.',code:'EMAIL_CODE_INVALID'}));}emailVerified=true;res.end(JSON.stringify({ok:true}));});return;}
 if(url.pathname==='/api/payments/catalog')return res.end(JSON.stringify({habilitado:true,precioCentimos:100,moneda:'PEN',dias:30,modo:'test'}));
 if(url.pathname==='/api/payments/checkout'){
   attempts.push(req.headers['x-idempotency-key']);req.resume();
   if(attempts.length===1){res.statusCode=503;return res.end(JSON.stringify({error:'PRIVATE_PROVIDER_PAYLOAD',code:'PAYMENT_TEST_SELLER_REQUIRED'}));}
   return res.end(JSON.stringify({url:'https://www.mercadopago.com/checkout/v1/redirect?pref_id=local-fixture',referencia:'12345678-1234-1234-1234-123456789012'}));
 }
 if(url.pathname==='/api/telemetry'){req.resume();res.statusCode=204;return res.end();}
 original(req,res);
});
async function run(){
 await fs.mkdir(out,{recursive:true});server.listen(Number(process.env.CIVIGO_MAP_SMOKE_FIXTURE_PORT||55709),'127.0.0.1');await once(server,'listening');await app.whenReady();
 const layouts=[];
 for(const [index,[width,height]]of [[390,844],[768,1024],[1366,768],[1920,1080]].entries()){
   const win=await createClient(700+index,width,height,{route:'/',mapReady:false,offscreen:true}),js=script=>win.webContents.executeJavaScript(script);
   await waitUntil(win,`!!document.querySelector('.home-film video')`);
   try { await waitUntil(win,`(()=>{const video=document.querySelector('.home-film video');return video.readyState>=2&&!video.paused&&video.currentTime>0.4&&video.videoWidth>0})()`,30000); }
   catch(error){console.error('Video playback state',await js(`(()=>{const v=document.querySelector('.home-film video');return{src:v.currentSrc,ready:v.readyState,paused:v.paused,time:v.currentTime,error:v.error&&{code:v.error.code,message:v.error.message},poster:v.poster}})()`));throw error;}
   const layout=await js(`(()=>{const film=document.querySelector('.home-film'),video=film.querySelector('video'),box=video.parentElement.getBoundingClientRect(),area=film.getBoundingClientRect();return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,videoWidth:box.width,areaWidth:area.width,loop:video.loop,muted:video.muted,fit:getComputedStyle(video).objectFit,oldColumns:!!document.querySelector('.hero')}})()`);
   assert.equal(layout.overflow,false);assert.equal(layout.loop,true);assert.equal(layout.muted,true);assert.equal(layout.fit,'cover');assert.equal(layout.oldColumns,false);assert.ok(Math.abs(layout.videoWidth-layout.areaWidth)<2,JSON.stringify(layout));
   layouts.push(layout);await fs.writeFile(path.join(out,`portada-${width}.png`),(await win.webContents.capturePage()).toPNG());win.destroy();
 }
 const win=await createClient(710,1366,768,{route:'/premium',mapReady:false,offscreen:true}),js=script=>win.webContents.executeJavaScript(script),redirects=[];
 win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).hostname==='www.mercadopago.com'){redirects.push(url);event.preventDefault();}});
 await waitUntil(win,`Array.from(document.querySelectorAll('.premium-checkout button')).some(b=>b.textContent.includes('Continuar a Mercado Pago')&&!b.disabled)`);
 assert.ok(await js(`document.querySelector('.premium-checkout h2').textContent.includes('1.00')`));
 assert.equal(await js(`document.querySelector('.premium-checkout').textContent.includes('entorno de prueba')`),false);
 await js(`Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError')}});Array.from(document.querySelectorAll('.premium-checkout button')).find(b=>b.textContent.includes('Continuar a Mercado Pago')).click()`);
 await waitUntil(win,`document.querySelector('.premium-checkout [role="alert"]')?.textContent.includes('vendedor de prueba')`);
 assert.equal(await js(`document.body.innerText.includes('PRIVATE_PROVIDER_PAYLOAD')`),false);
 await js(`Array.from(document.querySelectorAll('.premium-checkout button')).find(b=>b.textContent.includes('Continuar a Mercado Pago')).click()`);
 await waitUntil(win,`document.querySelector('.premium-checkout a[href^="https://www.mercadopago.com/"]')!==null`);
 await delay(300);assert.equal(redirects.length,1);assert.equal(attempts.length,2);for(const key of attempts)assert.match(key,/^[a-f0-9-]{36}$/i);
 assert.ok(await js(`Array.from(document.querySelectorAll('.premium-checkout button')).some(b=>b.textContent==='Pago preparado'&&b.disabled)`));
 await fs.writeFile(path.join(out,'pago-preparado.png'),(await win.webContents.capturePage()).toPNG());
 assert.deepEqual(await js(`window.__smokeErrors`),[]);assert.deepEqual(errors,[]);win.destroy();
 emailFlow=true;const verify=await createClient(711,390,844,{route:'/verificar',mapReady:false,offscreen:true}),vjs=script=>verify.webContents.executeJavaScript(script);
 await waitUntil(verify,`!!document.querySelector('section[aria-label="Verificar Gmail con código"]')`);
 await vjs(`document.querySelector('section[aria-label="Verificar Gmail con código"] button').click()`);
 await waitUntil(verify,`!!document.querySelector('input[name="email-code"]')`);
 assert.ok(await vjs(`document.querySelector('section[aria-label="Verificar Gmail con código"] button').disabled`));
 for(const code of ['111111','123456']){
   await vjs(`(()=>{const input=document.querySelector('input[name="email-code"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${code}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);
   await waitUntil(verify,`!document.querySelector('section[aria-label="Verificar Gmail con código"] button[type="submit"]').disabled`);
   await vjs(`document.querySelector('section[aria-label="Verificar Gmail con código"] form').requestSubmit()`);
   if(code==='111111')await waitUntil(verify,`document.querySelector('section[aria-label="Verificar Gmail con código"] [role="alert"]')?.textContent.includes('incorrecto')`);
 }
 await waitUntil(verify,`document.body.innerText.includes('Tu correo está verificado.')&&!document.querySelector('input[name="email-code"]')`);
 await fs.writeFile(path.join(out,'gmail-verificado.png'),(await verify.webContents.capturePage()).toPNG());assert.deepEqual(await vjs('window.__smokeErrors'),[]);verify.destroy();
 await fs.writeFile(path.join(out,'resultado.json'),JSON.stringify({passed:true,layouts,checkoutAttempts:attempts.length,externalNavigationStopped:true,emailCodeVerified:true},null,2));console.log(JSON.stringify({passed:true,viewports:layouts.length,paymentErrorsReadable:true,paymentPrepared:true,noCharge:true,emailCodeVerified:true}));
}
run().then(()=>app.exit(0)).catch(async error=>{console.error(error.stack);for(const [index,win]of windows.entries())if(!win.isDestroyed())await fs.writeFile(path.join(out,`fallo-${index}.png`),(await win.webContents.capturePage()).toPNG());app.exit(1);}).finally(()=>server.close());
