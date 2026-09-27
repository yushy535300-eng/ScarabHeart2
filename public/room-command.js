'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScarabRoomCommand = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function roomKey(value) {
    if (value == null) return '';
    const text = String(value).trim();
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
  }
  function findRecommendedRoom(boards, roomId, machineNum) {
    const all = [];
    if (boards && typeof boards === 'object') {
      for (const [board, rows] of Object.entries(boards)) if (Array.isArray(rows)) for (const row of rows) if (row) all.push(Object.assign({board}, row));
    }
    const id = String(roomId || '').trim();
    const number = roomKey(machineNum);
    let found = id ? all.find(row => row && String(row.roomId || '').trim() === id) : null;
    if (!found && number) found = all.find(row => row && roomKey(row.machineNum) === number);
    if (found) return found;
    if (number) return {roomId:'', machineNum:String(machineNum).trim(), source:'OVERLAY_COMMAND'};
    return null;
  }
  function dispatchGameCommand(raw, boards, actions) {
    let url;
    try { url = new URL(String(raw || '')); } catch (_) { return false; }
    if (url.hostname !== '__sethcmd__') return false;
    if (url.pathname === '/rooms') {
      actions.navigate('rooms');
      return true;
    }
    if (url.pathname === '/home') {
      actions.navigate('home');
      return true;
    }
    if (url.pathname === '/pick') {
      const room = findRecommendedRoom(boards, url.searchParams.get('ri'), url.searchParams.get('mn'));
      if (!room || !/^\d+$/.test(String(room.machineNum || ''))) {
        if (actions.invalid) actions.invalid();
        return true;
      }
      actions.navigate('rooms');
      actions.pick(room);
      return true;
    }
    return false;
  }
  return { findRecommendedRoom, roomKey, dispatchGameCommand };
});
