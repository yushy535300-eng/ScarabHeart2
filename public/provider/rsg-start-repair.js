/* A real DOM start control for RSG's loading screen. Its user click invokes
   only the existing LoadingBar completion callback, never a spin or a bet. */
(function () {
  'use strict';
  if (window.__scarabRsgStartRepair) return;
  var state = window.__scarabRsgStartRepair = { version: 2, bound: 0, starts: 0, lastEvent: 'waiting' };
  var binding = null, control = null, stopped = false, busy = false, lastReport = '';
  function scene() {
    try { return window.cc && window.cc.director && window.cc.director.getScene(); }
    catch (_) { return null; }
  }
  function isLoading(value) { return value && /^(?:loading|preload)_s(?:cene|cece)$/i.test(value.name); }
  function report(stage) {
    state.lastEvent = stage;
    if (stage === lastReport) return;
    lastReport = stage;
    try {
      var match = String(window.__SCARAB_PROXY_PREFIX || '').match(/^\/__game\/([a-f0-9]{24})$/);
      if (match && navigator.sendBeacon) navigator.sendBeacon('/api/provider-status/' + match[1],
        new Blob([JSON.stringify({stage:stage,scene:String((scene() || {}).name || ''),version:2,bound:state.bound})], {type:'application/json'}));
    } catch (_) {}
  }
  function remove() {
    if (control) control.remove();
    control = null; binding = null; state.bound = 0;
  }
  function ready(value) {
    return value && isLoading(scene()) && scene() === value.scene && value.node.activeInHierarchy &&
      value.button.enabledInHierarchy && value.button.interactable &&
      typeof value.bar._onFinishListener === 'function';
  }
  function bounds(value) {
    var canvas = document.getElementById('GameCanvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    var ui = value.node.getComponent('cc.UITransform');
    if (!ui || typeof ui._getRenderScene !== 'function') return null;
    var cameras = ui._getRenderScene().cameras || [], box = ui.getBoundingBoxToWorld();
    var camera = cameras.find(function (c) {
      return (c.visibility & value.node.layer) && (!c.window || c.window.swapchain) && c.systemWindowId === 0;
    });
    if (!camera || typeof camera.worldToScreen !== 'function') return null;
    var points = [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(function (p) {
      return camera.worldToScreen({x:0,y:0,z:0},{x:p[0],y:p[1],z:value.node.worldPosition.z});
    });
    var rect = canvas.getBoundingClientRect();
    var minX = Math.min.apply(null,points.map(function(p){return p.x;}));
    var maxX = Math.max.apply(null,points.map(function(p){return p.x;}));
    var minY = Math.min.apply(null,points.map(function(p){return p.y;}));
    var maxY = Math.max.apply(null,points.map(function(p){return p.y;}));
    var result = {left:rect.left+minX*rect.width/canvas.width,top:rect.bottom-maxY*rect.height/canvas.height,
      width:(maxX-minX)*rect.width/canvas.width,height:(maxY-minY)*rect.height/canvas.height};
    return Object.keys(result).every(function(k){return Number.isFinite(result[k]);}) && result.width>20 && result.height>10 ? result : null;
  }
  function activate(event) {
    if (event.isTrusted === false || stopped || busy || !ready(binding)) return;
    event.preventDefault(); event.stopPropagation();
    var value = binding;
    busy = true; control.disabled = true; state.starts++;
    report('native-start');
    try {
      // This is the same callback that RSG's LoadingBar calls after start.
      // Calling it from the real DOM button avoids Cocos' dropped click event.
      value.bar._onFinishListener.call(value.bar);
    } catch (error) {
      busy = false; if (control) control.disabled = false; report('callback-error');
      console.warn('[ScarabHeart RSG start]', error && error.message);
    }
    setTimeout(function () {
      if (stopped) return;
      if (!isLoading(scene()) || scene() !== value.scene) { report('entered'); remove(); }
      else { busy = false; if (control) control.disabled = false; report('still-loading'); }
    }, 2000);
  }
  function scan() {
    if (stopped) return;
    try {
      var current = scene();
      if (!isLoading(current)) {
        if (binding) { if (busy) report('entered'); remove(); }
        return;
      }
      if (binding && binding.scene !== current) remove();
      if (!binding) {
        var visited = 0;
        function walk(node) {
          if (!node || binding || ++visited>3000) return;
          (node._components || []).some(function (bar) {
            var button = bar && bar.btnStart;
            if (button && button.node && typeof bar._onFinishListener === 'function' && typeof bar.setEnableStartButton === 'function') {
              binding = {bar:bar,button:button,node:button.node,scene:current}; state.bound = 1; return true;
            }
            return false;
          });
          if (!binding) (node.children || []).some(function(child){walk(child);return !!binding;});
        }
        walk(current);
      }
      if (!ready(binding)) { if (control) control.style.display = 'none'; return; }
      var rect = bounds(binding);
      if (!rect) { report('layout-unavailable'); return; }
      if (!control) {
        control = document.createElement('button'); control.id = '__scarabRsgNativeStart'; control.type = 'button';
        control.setAttribute('aria-label','開始進入遊戲');
        control.style.cssText = 'position:fixed;z-index:2147483000;appearance:none;-webkit-appearance:none;background:transparent;color:transparent;border:0;padding:0;margin:0;cursor:pointer;touch-action:manipulation;outline:none;';
        control.addEventListener('click',activate);
        document.body.appendChild(control); report('ready');
      }
      control.style.display = 'block';
      ['left','top','width','height'].forEach(function(k){control.style[k]=rect[k]+'px';});
    } catch (_) { report('scan-error'); }
  }
  var timer = setInterval(scan, 150);
  window.addEventListener('resize',scan);
  window.addEventListener('pagehide',function(){stopped=true;clearInterval(timer);window.removeEventListener('resize',scan);remove();},{once:true});
})();
