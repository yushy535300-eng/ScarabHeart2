const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runPacket(packet) {
  const panel = { spoilerOn: true, spoilerWin: null };
  const cryptoTool = { variant: 'custom', decrypt: value => value };
  const window = {
    __sethEngine: { panel },
    System: { get: () => ({ CryptoTool: cryptoTool }) },
    addEventListener() {}
  };
  const context = {
    window, Date, Number, Array, Object, Math, String,
    setTimeout() {}, setInterval() { return 1; }, clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync('runtime/atg-live-adapter.js', 'utf8'), context);
  cryptoTool.decrypt(packet);
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
const captured = runPacket({ data: { result: [explicit] } });
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
assert.equal(runPacket(ambiguousOnly), null);
console.log('PASS: Seth2 captures explicit free-game totals and rejects ambiguous per-spin totalWinnings.');
