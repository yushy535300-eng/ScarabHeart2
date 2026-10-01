const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runSpinAck(ack) {
  const panel = { spoilerOn: true, spoilerWin: null };
  const intervals = [];
  const socket = {
    connected: true,
    handlers: {},
    on(name, fn) { this.handlers[name] = fn; },
    emit(...args) { this.lastEmit = args; return 'emit-return'; }
  };
  const window = {
    __sethEngine: { panel },
    App: { serviceManager: { services: [{ _client: { _io: socket } }] } },
    addEventListener() {}
  };
  const context = {
    window, Date, Number, Array, Object, Math, String,
    setTimeout() {}, setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync('runtime/atg-live-adapter.js', 'utf8'), context);
  intervals.forEach(fn => fn()); // runs service/socket discovery
  let callbackCalled = false;
  const emitResult = socket.emit('spin', { action: 'buyFeature' }, function () { callbackCalled = true; });
  const ackCallback = socket.lastEmit[2];
  ackCallback(ack);
  assert.equal(callbackCalled, true);
  assert.equal(emitResult, 'emit-return');
  return panel.spoilerWin;
}

const explicit = {
  status: 200,
  engine: {
    buyFeatureType: 'superFreeGame',
    gameState: [{
      totalWinnings: 8888,
      freeGameCount: 10,
      freeGameRecords: { totalWin: 125.5 }
    }]
  }
};
const captured = runSpinAck({ data: { result: [explicit] } });
assert.equal(captured.totalWin, 125.5);
assert.equal(captured.fg, 10);
assert.equal(typeof captured.ts, 'number');

const ambiguousOnly = {
  status: 200,
  engine: {
    buyFeatureType: 'superFreeGame',
    gameState: [{ totalWinnings: 8888, freeGameCount: 10 }]
  }
};
assert.equal(runSpinAck(ambiguousOnly), null);
console.log('PASS: spin ACK callback is observed; explicit bonus totals pass and per-spin totals are rejected.');
