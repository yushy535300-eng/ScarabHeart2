/* ScarabHeart iOS v1.11 - Capacitor 8 InAppBrowser compatibility bridge.
   The native proxy is resolved lazily because plugin headers can arrive after
   this static page starts evaluating. */
(function () {
  'use strict';
  function capacitor() { return window.Capacitor || null; }
  function isIOS() {
    try { var cap = capacitor(); return !!(cap && cap.getPlatform && cap.getPlatform() === 'ios'); }
    catch (_) { return false; }
  }

  var nativePlugin = null;
  function resolveNativePlugin() {
    if (nativePlugin) return nativePlugin;
    var cap = capacitor();
    if (!cap) return null;
    var plugins = cap.Plugins || (cap.Plugins = {});
    nativePlugin = plugins.CapgoInAppBrowser || plugins.InAppBrowser || null;
    if (nativePlugin) return nativePlugin;

    // Static HTML does not import the npm module, so explicitly register the
    // JavaScript proxy for whichever native plugin name Capacitor reports.
    if (typeof cap.registerPlugin === 'function') {
      var names = ['CapgoInAppBrowser', 'InAppBrowser'];
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        try {
          if (!cap.isPluginAvailable || cap.isPluginAvailable(name)) {
            nativePlugin = cap.registerPlugin(name);
            if (nativePlugin) return nativePlugin;
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function failedRef(url, message) {
    var handlers = {};
    return {
      addEventListener: function (name, fn) {
        (handlers[name] || (handlers[name] = [])).push(fn);
        if (name === 'loaderror') setTimeout(function () { try { fn({ url: url, message: message }); } catch (_) {} }, 0);
      },
      removeEventListener: function () {},
      executeScript: function () {},
      close: function () {}, show: function () {}, hide: function () {}
    };
  }

  function makeRef(url, target, features) {
    var IAB = resolveNativePlugin();
    if (!IAB) {
      console.error('[Scarab iOS] native InAppBrowser plugin unavailable');
      return failedRef(url, 'iOS 原生遊戲視窗尚未載入');
    }

    var seq = (makeRef._seq = (makeRef._seq || 0) + 1);
    var rid = 'scarab-' + seq, nativeId = null, closed = false, pending = [], handlers = {}, currentUrl = url;
    function emit(name, payload) { (handlers[name] || []).slice().forEach(function (fn) { try { fn(payload || {}); } catch (_) {} }); }
    function on(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); }
    function off(name, fn) { var a = handlers[name] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    function runOrQueue(fn) { if (nativeId) fn(nativeId); else pending.push(fn); }
    var ref = {
      _scarabId: rid,
      addEventListener: on,
      removeEventListener: off,
      executeScript: function (opts, cb) {
        var code = (opts && opts.code) || '';
        runOrQueue(function (id) {
          IAB.executeScript({ id: id, code: code }).then(function (r) {
            try { if (cb) cb(r && r.result != null ? [r.result] : []); } catch (_) {}
          }).catch(function (e) { console.warn('[Scarab iOS] executeScript', e); });
        });
      },
      close: function () { closed = true; runOrQueue(function (id) { IAB.close({ id: id }).catch(function () {}); }); },
      show: function () { runOrQueue(function (id) { if (IAB.show) IAB.show({ id: id }).catch(function () {}); }); },
      hide: function () { runOrQueue(function (id) { if (IAB.hide) IAB.hide({ id: id }).catch(function () {}); }); }
    };

    if (target === '_system') {
      IAB.open({ url: url }).catch(function (e) { console.warn('[Scarab iOS] external open', e); });
      return ref;
    }

    var noToolbar = /(^|,)\s*toolbar\s*=\s*no(?:,|$)/i.test(features || '');
    var isATG = /(^|,)\s*scarabatg\s*=\s*yes(?:,|$)/i.test(features || '');
    var atgDocumentStart = "(function(){if(window.__scarabATGStandalone)return;window.__scarabATGStandalone=1;" +
      "try{Object.defineProperty(navigator,'standalone',{configurable:true,get:function(){return true}})}catch(e){}" +
      "try{var mm=window.matchMedia.bind(window);window.matchMedia=function(q){if(/display-mode\\s*:\\s*(standalone|fullscreen)/i.test(String(q))){return {matches:true,media:q,onchange:null,addListener:function(){},removeListener:function(){},addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return true}}}return mm(q)}}catch(e){}" +
      "function ready(){try{var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';(document.head||document.documentElement).appendChild(m)}m.content='width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';document.documentElement.style.setProperty('overflow','hidden','important');if(document.body){document.body.style.setProperty('overflow','hidden','important');document.body.style.setProperty('overscroll-behavior','none','important')}window.scrollTo(0,0);window.dispatchEvent(new Event('resize'))}catch(e){}}" +
      "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();window.addEventListener('load',ready);window.addEventListener('orientationchange',function(){setTimeout(ready,0);setTimeout(ready,150)});})();";
    var opts = {
      url: url,
      toolbarType: noToolbar ? 'blank' : 'activity',
      enabledSafeTopMargin: false,
      enabledSafeBottomMargin: false,
      activeNativeNavigationForWebview: true,
      disableOverscroll: true,
      enableReloadGesture: false,
      persistWebViewData: true,
      useSharedDataStore: true,
      openBlankTargetInWebView: true
    };
    IAB.openWebView(opts).then(function (r) {
      nativeId = r && r.id;
      if (!nativeId) throw new Error('openWebView did not return an id');
      // ATG redirects more than once before reaching the game. Never defer
      // presentation (that can leave iOS on a white hidden WebView); apply the
      // standalone/fullscreen compatibility script immediately instead.
      if (isATG) IAB.executeScript({ id: nativeId, code: atgDocumentStart }).catch(function () {});
      if (closed) IAB.close({ id: nativeId }).catch(function () {});
      var q = pending.splice(0); q.forEach(function (fn) { try { fn(nativeId); } catch (_) {} });
    }).catch(function (e) {
      console.error('[Scarab iOS] openWebView failed', e);
      emit('loaderror', { url: url, message: String(e && e.message ? e.message : e) });
    });

    function listen(ev, fn) {
      try {
        Promise.resolve(IAB.addListener(ev, function (d) {
          if (nativeId && d && d.id && d.id !== nativeId) return;
          fn(d || {});
        })).catch(function () {});
      } catch (_) {}
    }
    listen('browserPageLoadStart', function (d) { currentUrl = (d && d.url) || currentUrl;if(isATG&&nativeId)IAB.executeScript({id:nativeId,code:atgDocumentStart}).catch(function(){});emit('loadstart', { url: currentUrl }); });
    listen('urlChangeEvent', function (d) { var u = (d && (d.url || d.value)) || currentUrl; currentUrl = u; emit('loadstart', { url: u }); });
    listen('browserPageLoaded', function (d) { currentUrl = (d && d.url) || currentUrl;if(isATG&&nativeId)IAB.executeScript({id:nativeId,code:atgDocumentStart}).catch(function(){});emit('loadstop', { url: currentUrl }); });
    listen('pageLoadError', function (d) { currentUrl = (d && d.url) || currentUrl; emit('loaderror', { url: currentUrl, message: (d && d.message) || '' }); });
    listen('closeEvent', function (d) { emit('exit', d); });
    return ref;
  }

  function installBridge() {
    if (!isIOS()) return false;
    window.cordova = window.cordova || {};
    window.cordova.InAppBrowser = { open: makeRef };
    var ready = !!resolveNativePlugin();
    console.log('[Scarab iOS] InAppBrowser bridge installed, native=' + ready);
    return ready;
  }

  installBridge();
  document.addEventListener('deviceready', installBridge, false);
  document.addEventListener('DOMContentLoaded', installBridge, false);
  setTimeout(installBridge, 250);
  setTimeout(installBridge, 1000);
})();
