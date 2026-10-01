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

for (const score of [125.5, 8888]) {
  const ack = {
    status: 200,
    engine: {
      buyFeatureType: 'superFreeGame',
      gameState: [{
        totalWinnings: score,
        freeGameCount: 10,
        freeGameRecords: { totalWin: 125.5 }
      }]
    }
  };
  assert.equal(runPacket(ack), null);
}
console.log('PASS: Socket.IO ACK values cannot overwrite the GameData spoiler score.');
