(function(){
  if(window.__scarabFloatingThemeInstalled)return;
  window.__scarabFloatingThemeInstalled=true;
  var style=document.createElement('style');style.id='scarab-floating-theme';
  style.textContent=`
  #__lunarHud,#__thorHud{
    width:min(190px,calc(100vw - 16px))!important;box-sizing:border-box!important;
    padding:8px!important;color:#edf8ff!important;
    background:linear-gradient(155deg,rgba(10,29,47,.97),rgba(3,9,18,.98))!important;
    border:1px solid rgba(82,228,255,.55)!important;border-radius:15px!important;
    box-shadow:0 12px 34px rgba(0,0,0,.58),0 0 20px rgba(42,190,240,.12),inset 0 1px rgba(255,255,255,.07)!important;
    font-family:Inter,-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif!important;
    color-scheme:dark;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  }
  #__lunarBar,#__thorBar{min-height:34px!important;margin-bottom:6px!important;padding:0 22px 0 1px!important;justify-content:flex-start!important;gap:7px!important;border-bottom:1px solid rgba(82,228,255,.2);}
  #__lunarBar img,#__thorBar img{width:28px!important;height:28px!important;object-fit:contain!important;filter:drop-shadow(0 0 6px rgba(82,228,255,.3));}
  #__lunarBar span,#__thorBar .seth-thor-brand{color:#f2cb70!important;font-size:12px!important;font-weight:800!important;letter-spacing:.08em!important;}
  #__lunarMin,#__thorMin{color:#d8eaf6!important;font-size:19px!important;}
  #__lunarBody>div:first-child,#__thorBody>div:first-child{padding:7px 5px!important;margin-bottom:7px!important;border:1px solid rgba(82,228,255,.22)!important;border-radius:11px!important;background:linear-gradient(145deg,rgba(15,43,65,.84),rgba(5,15,27,.93))!important;}
  #__lunarBody>div:first-child>div:first-child,#__thorBody>div:first-child>div:first-child{color:#93adc0!important;font-size:10px!important;letter-spacing:.06em;}
  #__lunarPnl,#__thorPnl{font-size:24px!important;font-weight:850!important;text-shadow:0 0 12px currentColor;}
  #__lunarBal,#__lunarStatus,#__thorStatus{color:#9db3c3!important;font-size:10px!important;}
  #__lunarWin,#__thorWin{color:#f2cb70!important;}
  #__lunarMeter{color:#70e7b0!important;}
  #__lunarSpeed button,#__thorSpeed button,#__thorReset,#__thorHome,#__thorRisk{min-height:29px!important;border:1px solid rgba(103,174,208,.3)!important;border-radius:8px!important;background:rgba(10,28,44,.96)!important;color:#b7ccdb!important;font-weight:750!important;}
  #__lunarSpeed button[data-active="true"],#__lunarSpeed button[aria-pressed="true"],#__thorSpeed button[data-active="true"]{border-color:#f2cb70!important;background:linear-gradient(145deg,#f2cb70,#c5963c)!important;color:#101722!important;box-shadow:0 0 12px rgba(242,203,112,.2)!important;}
  #__lunarSpoilBtn,#__thorFasSw{border:1px solid rgba(82,228,255,.45)!important;background:#17314a!important;}
  #__lunarHud button,#__thorHud button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
  #__lunarHud [style*="#9c8a66"],#__lunarHud [style*="#c9b890"],#__thorHud [style*="#a99b70"]{color:#9db3c3!important;}
  `;
  (document.head||document.documentElement).appendChild(style);
})();
