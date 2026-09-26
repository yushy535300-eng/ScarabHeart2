/* v3.12 six-game ATG recommendation probe.
   The browser no longer tries to discover Cocos/SystemJS model internals.
   The same-origin server bridge passively decodes ATG's real Socket.IO initial
   machine table (and probe-only additional pages) and exposes one bounded snapshot. */
(function () {
  'use strict';
  if (window.__scarabSixRecommendationProbeInstalled) return;
  window.__scarabSixRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var startedAt = Date.now();
  var done = false;
  var lastStage = '';
  var timer = null;

  function tell(payload) {
    try { parent.postMessage(Object.assign({__scarabRecommendationProbe:true,gameCode:gameCode}, payload || {}), location.origin); }
    catch (_) {}
  }

  function progress(stage, detail) {
    var key = String(stage || '') + '|' + String(detail || '');
    if (done || key === lastStage) return;
    lastStage = key;
    tell({progress:true,stage:String(stage || ''),detail:String(detail || '')});
  }

  function sidFromPrefix() {
    var prefix = String(window.__SCARAB_PROXY_PREFIX || '');
    var m = prefix.match(/^\/__game\/([a-f0-9]{24})$/i);
    return m ? m[1] : '';
  }

  function finish(ok, body) {
    if (done) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (ok) {
      tell({
        ok:true,
        source:'atg-server-socket-table',
        capturedAt:Date.now(),
        tableMeta:body && body.tableMeta || null,
        partial:!!(body && body.partial),
        tables:Array.isArray(body && body.tables) ? body.tables : []
      });
    } else {
      tell({ok:false,error:String(body && body.error || body || 'ATG machine table capture failed')});
    }
  }

  async function poll() {
    if (done) return;
    var sid = sidFromPrefix();
    if (!sid) {
      if (Date.now() - startedAt > 5000) return finish(false, '找不到 ATG probe session');
      return schedule(120);
    }
    try {
      var res = await fetch('/__game/session/' + encodeURIComponent(sid) + '/probe-tables', {
        cache:'no-store', credentials:'same-origin'
      });
      if (!res.ok) throw new Error('probe endpoint HTTP ' + res.status);
      var body = await res.json();
      var status = String(body && body.status || 'boot');
      var count = Number(body && body.count || 0);
      var pages = Array.isArray(body && body.pagesLoaded) ? body.pagesLoaded.length : 0;
      var totalPages = Number(body && body.totalPages || 1);
      if (status === 'boot') progress('boot','等待 ATG Socket');
      else if (status === 'connected') progress('system','ATG Socket 已連線');
      else if (status === 'paging') progress('tables','已取得 ' + count + ' 台，載入 ' + pages + '/' + totalPages + ' 頁');
      else if (status === 'tables') progress('tables','已取得 ' + count + ' 台');
      else if (status === 'failed') return finish(false, body);
      else if (status === 'complete') progress('tables','完成 ' + count + ' 台');

      if (body && body.complete && Array.isArray(body.tables) && body.tables.length) {
        return finish(true, body);
      }
      // A single-page initial response should normally flip to complete almost
      // immediately. Keep polling briefly rather than reading page globals.
      if (Date.now() - startedAt > 32000) {
        if (body && Array.isArray(body.tables) && body.tables.length) {
          body.partial = true;
          return finish(true, body);
        }
        return finish(false, body && body.error ? body : 'ATG 機台資料逾時');
      }
    } catch (error) {
      if (Date.now() - startedAt > 32000) return finish(false, String(error && error.message || error));
    }
    schedule(180);
  }

  function schedule(ms) {
    if (done) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(poll, ms || 180);
  }

  progress('boot','建立 ATG 機台連線');
  schedule(60);
})();
