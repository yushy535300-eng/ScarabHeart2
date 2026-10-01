const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runPacket(packet) {
  const panel = { spoilerOn: true, spoilerWin: null };
  const decrypt = value => value;
  const cryptoTool = { variant: 'custom', decrypt };
  const window = {
    __sethEngine: { panel },
    System: { get: () => ({ CryptoTool: cryptoTool }) },
    addEventListener() {}
  };
  const context = {
    window,
    Date,
    Number,
    Array,
    Object,
    Math,
    String,
    setTimeout() {},
    setInterval() { return 1; },
    clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync('runtime/atg-live-adapter.js', 'utf8'), context);
  cryptoTool.decrypt(packet);
  return panel.spoilerWin;
}

const body = {
  status: 200,
  engine: {
    buyFeatureType: 'superFreeGame',
    gameState: [
      { totalWinnings: 40, freeGameCount: 8 },
      { totalWinnings: 125.5, freeGameCount: 10 }
    ]
  }
};

for (const result of [runPacket(body), runPacket({ data: { result: body } })]) {
  assert.equal(result.totalWin, 125.5);
  assert.equal(result.fg, 10);
  assert.equal(typeof result.ts, 'number');
}
console.log('PASS: Seth2 free-game ACKs with no eventName and nested response envelopes are captured.');
