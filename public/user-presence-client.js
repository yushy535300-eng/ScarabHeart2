"use strict";
var ScarabPresence = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../mt_project_inspect/MT-Assistant-Web-V3-main/lib/user-presence-client.ts
  var user_presence_client_exports = {};
  __export(user_presence_client_exports, {
    connectUserPresence: () => connectUserPresence
  });
  function connectUserPresence(sessionId, getRunning) {
    let stopped = false;
    let authRejected = false;
    let socket = null;
    let authenticated = false;
    let lastRunning = null;
    let reconnectTimer = null;
    let retryMs = 1e3;
    function reportState() {
      if (!authenticated || socket?.readyState !== WebSocket.OPEN) return;
      let running = false;
      try {
        running = getRunning() === true;
      } catch {
      }
      if (lastRunning === running) return;
      socket.send(JSON.stringify({ type: "state", running }));
      lastRunning = running;
    }
    function connect() {
      if (stopped || authRejected || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const url = new URL("/api/presence/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(url.href);
      socket = current;
      authenticated = false;
      lastRunning = null;
      current.onopen = () => {
        if (stopped || current !== socket) {
          current.close();
          return;
        }
        current.send(JSON.stringify({ type: "auth", sessionId }));
      };
      current.onmessage = (event) => {
        if (current !== socket || stopped) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "authenticated") {
            authenticated = true;
            retryMs = 1e3;
            reportState();
          }
        } catch {
        }
      };
      current.onclose = (event) => {
        if (current !== socket) return;
        socket = null;
        authenticated = false;
        if (event.code === 1008 || event.code === 4001 || event.code === 4401) {
          authRejected = true;
          return;
        }
        if (stopped) return;
        reconnectTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(15e3, retryMs * 2);
      };
      current.onerror = () => {
      };
    }
    const statusTimer = setInterval(reportState, 500);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        connect();
        reportState();
      }
    };
    const onOnline = () => connect();
    const onPageHide = () => {
      authenticated = false;
      socket?.close(1e3, "page-hidden");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisible);
    connect();
    return {
      dispose() {
        stopped = true;
        authenticated = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        clearInterval(statusTimer);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onVisible);
        socket?.close(1e3, "signed-out");
        socket = null;
      }
    };
  }
  return __toCommonJS(user_presence_client_exports);
})();
