(function(){
  if(window.__scarabRsgNavigation)return;
  window.__scarabRsgNavigation=true;
  var tries=0,t=setInterval(function(){
    var key=sessionStorage.getItem('LobbySession');
    if(!key){if(++tries>60)clearInterval(t);return;}
    clearInterval(t);
    fetch('../Lobby/GetGameURL?k='+encodeURIComponent(key)+'&id=129&lobby=2',{cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error('連線失敗');return r.json()})
      .then(function(d){
        if(!d||!d.newsession||!d.nextpage)throw new Error('雷神暫時無法進入');
        var target=new URL(d.nextpage,window.__SCARAB_ORIGINAL_URL||location.href);
        var expected=new URL(window.__SCARAB_ORIGINAL_URL||location.href);
        if(target.protocol!=='https:'||target.hostname!==expected.hostname||!/^\/Web\/SlotGame\d/i.test(target.pathname))throw new Error('遊戲入口不正確');
        sessionStorage.setItem('GameWebSession2',d.newsession);
        localStorage.setItem('backupSession',d.newsession);
        location.href=window.__SCARAB_PROXY_PREFIX?window.__SCARAB_PROXY_PREFIX+target.pathname+target.search:target.href;
      }).catch(function(){window.__scarabRsgNavigation=false;var p=document.createElement('div');p.textContent='雷神暫時無法進入，請返回後重試。';p.style.cssText='position:fixed;top:16px;left:10%;width:80%;padding:16px;background:#071522;color:#edf8ff;z-index:2147483647';document.body.appendChild(p);});
  },500);
})();
