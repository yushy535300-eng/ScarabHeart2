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
  return { findRecommendedRoom, roomKey };
});
