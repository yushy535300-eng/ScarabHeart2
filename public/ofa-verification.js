(()=>{
  'use strict';
  const SITE_KEY='0x4AAAAAAFk1nKm7tztnbT_R';
  let loading,active=false,retryAt=0;
  function load(){
    if(window.turnstile)return Promise.resolve(window.turnstile);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;
      const timer=setTimeout(()=>{loading=null;script.remove();reject(Error('OFA 安全驗證載入逾時，請重試'));},20000);
      script.onload=()=>{clearTimeout(timer);if(window.turnstile)resolve(window.turnstile);else{loading=null;reject(Error('OFA 安全驗證無法載入'));}};
      script.onerror=()=>{clearTimeout(timer);loading=null;script.remove();reject(Error('無法連線到 OFA 安全驗證服務'));};
      document.head.append(script);
    });
    return loading;
  }
  function rateLimited(header){
    const seconds=Number(header),date=Date.parse(header||'');
    const delay=Number.isFinite(seconds)&&seconds>0?seconds*1000:Number.isFinite(date)&&date>Date.now()?date-Date.now():60000;
    retryAt=Math.max(retryAt,Date.now()+delay);
    return 'OFA 暫時限制登入次數，請於 '+Math.ceil((retryAt-Date.now())/1000)+' 秒後重試';
  }
  async function requestToken(){
    if(Date.now()<retryAt)throw Error('OFA 暫時限制登入次數，請於 '+Math.ceil((retryAt-Date.now())/1000)+' 秒後重試');
    if(active)throw Error('請先完成目前的 OFA 安全驗證');
    active=true;
    let overlay,widget,api,cleanup=()=>{active=false;};
    try{
      api=await load();
      return await new Promise((resolve,reject)=>{
        overlay=document.createElement('div');
        overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','OFA 安全驗證');
        overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#000b;padding:12px';
        const panel=document.createElement('div');panel.style.cssText='box-sizing:border-box;width:min(100%,380px);padding:20px 12px;background:#102330;color:#fff;border:1px solid #b79b64;border-radius:14px;text-align:center;font:14px system-ui';
        const title=document.createElement('h2');title.textContent='OFA 安全驗證';title.style.cssText='font-size:18px;margin:0 0 12px';
        const hint=document.createElement('p');hint.textContent='請完成下方驗證，完成後會繼續登入。';hint.style.cssText='line-height:1.6;color:#d5e2e7';
        const host=document.createElement('div');host.style.cssText='min-height:70px;display:flex;justify-content:center';
        const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.style.cssText='margin-top:16px;padding:9px 22px;border:1px solid #758990;border-radius:7px;background:#203745;color:#fff;cursor:pointer';
        const previous=document.activeElement;
        const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(Error('已取消 OFA 安全驗證'));}};
        cleanup=()=>{document.removeEventListener('keydown',onKey,true);if(api&&widget!==undefined)try{api.remove(widget);}catch{}overlay.remove();active=false;previous?.focus?.();};
        let settled=false;
        const finish=(error,token)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(token);};
        cancel.onclick=()=>finish(Error('已取消 OFA 安全驗證'));
        panel.append(title,hint,host,cancel);overlay.append(panel);document.body.append(overlay);document.addEventListener('keydown',onKey,true);cancel.focus();
        widget=api.render(host,{sitekey:SITE_KEY,language:'zh-tw',callback:token=>{if(typeof token==='string'&&token)finish(null,token);},
          'expired-callback':()=>finish(Error('OFA 安全驗證已過期，請重新登入')),
          'error-callback':code=>{const c=String(code);finish(Error(c==='110200'?'OFA 尚未授權此程式網域使用安全驗證，需由 OFA 開放網域。':'OFA 安全驗證失敗（'+c+'），請重試'));return true;},
          'timeout-callback':()=>finish(Error('OFA 安全驗證逾時，請重新登入'))});
      });
    }finally{cleanup();}
  }
  window.ScarabOfaVerification=Object.freeze({requestToken,rateLimited});
})();
