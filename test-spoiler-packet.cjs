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

const result = runPacket({
  eventName: 'spin',
  status: 200,
  engine: {
    buyFeatureType: 'freeGame',
    gameState: [
      { totalWinnings: 40, freeGameCount: 8 },
      { totalWinnings: 125.5, freeGameCount: 10 }
    ]
  }
});
assert.equal(result.totalWin, 125.5);
assert.equal(result.fg, 10);
assert.equal(typeof result.ts, 'number');
assert.equal(runPacket({
  eventName: 'other',
  engine: { buyFeatureType: 'freeGame', gameState: [{ totalWinnings: 125.5 }] }
}), null);
console.log('PASS: restored v3.18.21 Seth2 spin packet path publishes the score and free-game count.');
