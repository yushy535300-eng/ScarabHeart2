/* Complete a user-initiated RSG loading-button click when Cocos loses release.
   Never initiates a gesture, spins, bets, or calls a scene callback directly. */
(function () {
  'use strict';
  if (window.__scarabRsgStartRepair) return;
  var state = window.__scarabRsgStartRepair = { recovered: 0, bound: 0, lastEvent: 'idle' };
  var pending = null, releaseSerial = 0, bindings = [], stopped = false;
  function loadingScene() {
    try {
      var cc = window.cc, scene = cc && cc.director && cc.director.getScene();
      return scene && /^(?:loading|preload)_s(?:cene|cece)$/i.test(scene.name) ? scene : null;
    } catch (_) { return null; }
  }
  function unbind() {
    bindings.forEach(function (b) {
      b.node.off('click', b.cancel);
    });
    bindings = []; pending = null; state.bound = 0;
  }
  function scan() {
    if (stopped) return;
    var scene = loadingScene();
    if (!scene) { if (bindings.length) unbind(); return; }
    if (bindings.length && bindings[0].scene !== scene) unbind();
    if (bindings.length) return;
    var visited = 0;
    function walk(node) {
      if (!node || ++visited > 3000) return;
      (node._components || []).forEach(function (bar) {
        var button = bar && bar.btnStart, target = button && button.node;
        if (!target || typeof bar._onFinishListener !== 'function' ||
            typeof bar.setEnableStartButton !== 'function' ||
            bindings.some(function (b) { return b.node === target; })) return;
        var binding = { node: target, button: button, scene: scene };
        binding.cancel = function () {
          if (pending && pending.binding === binding) pending = null;
        };
        target.on('click', binding.cancel);
        bindings.push(binding); state.bound = bindings.length;
      });
      (node.children || []).forEach(walk);
    }
    walk(scene);
  }
  function down(event) {
    if (event.isTrusted === false || (event.button != null && event.button !== 0)) return;
    var canvas = document.getElementById('GameCanvas'), point = event.touches && event.touches[0] || event;
    if (!canvas || event.target !== canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    scan(); pending = null; releaseSerial++;
    bindings.some(function (binding) {
      var button = binding.button;
      if (!binding.node.activeInHierarchy || !button.enabledInHierarchy || !button.interactable) return false;
      var transform = binding.node.getComponent('cc.UITransform');
      if (!transform || !transform.hitTest({x:(point.clientX-rect.left)*canvas.width/rect.width,y:(rect.bottom-point.clientY)*canvas.height/rect.height})) return false;
      pending = {binding:binding,at:Date.now(),x:point.clientX,y:point.clientY};
      state.lastEvent = 'pressed'; return true;
    });
  }
  function cancel() { pending = null; releaseSerial++; }
  function move(event) {
    if (!pending) return;
    var point = event.touches && event.touches[0] || event;
    if (Math.hypot(point.clientX-pending.x,point.clientY-pending.y)>12) cancel();
  }
  function release(event) {
    if (event.isTrusted === false) return;
    var canvas = document.getElementById('GameCanvas');
    if (!canvas || event.target !== canvas || (event.button != null && event.button !== 0)) return;
    var touch = event.changedTouches && event.changedTouches[0], point = touch || event;
    if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = (point.clientX - rect.left) * canvas.width / rect.width;
    var y = (rect.bottom - point.clientY) * canvas.height / rect.height;
    var at = Date.now(), serial = ++releaseSerial; state.lastEvent = 'released';
    // Let Cocos dispatch its queued events and its original 150 ms callback first.
    setTimeout(function () {
      if (stopped || serial !== releaseSerial || !pending ||
          pending.at < at - 1500 || pending.at > at + 150) { state.lastEvent = pending ? 'stale' : 'no-press'; return; }
      var binding = pending.binding, button = binding.button;
      if (loadingScene() !== binding.scene || !binding.node.activeInHierarchy ||
          !button.enabledInHierarchy || !button.interactable) return;
      try {
        var transform = binding.node.getComponent('cc.UITransform');
        if (!transform || !transform.hitTest({ x: x, y: y })) { state.lastEvent = 'outside'; return; }
        pending = null; state.recovered++; state.lastEvent = 'recovered';
        binding.node.emit('click', button);
      } catch (error) { console.warn('[ScarabHeart RSG start]', error && error.message); }
    }, 350);
  }
  var listeners = {pointerdown:down,mousedown:down,touchstart:down,pointermove:move,mousemove:move,touchmove:move,pointercancel:cancel,touchcancel:cancel,pointerup:release,mouseup:release,touchend:release};
  Object.keys(listeners).forEach(function (name) {
    document.addEventListener(name, listeners[name], true);
  });
  var timer = setInterval(scan, 250);
  window.addEventListener('pagehide', function () {
    stopped = true; clearInterval(timer); unbind();
    Object.keys(listeners).forEach(function (name) {
      document.removeEventListener(name, listeners[name], true);
    });
  }, { once: true });
})();
