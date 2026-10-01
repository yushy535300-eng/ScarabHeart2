const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('runtime/overlay-runtime.js', 'utf8');
const toast = source.slice(source.indexOf('function toast('), source.indexOf('function resetSpoilerResult('));
const start = source.indexOf('function __showTopSpoiler(');
const show = source.slice(start, source.indexOf("var __lastSpoilerSig=", start));

function display(score) {
  const elements = new Map();
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement() {
      const children = { '.score': { style: {} }, '.count': { style: {} } };
      return { style: {}, setAttribute() {}, querySelector(key) { return children[key]; }, remove() { elements.delete(this.id); } };
    },
    body: { appendChild(node) { elements.set(node.id, node); } }
  };
  const context = vm.createContext({ document, spoil: true, __suppressNativeSpoiler() {}, setTimeout() {}, clearTimeout() {} });
  vm.runInContext(toast + '\n' + show, context);
  context.toast(score, 15, false);
  return elements.get('shSpoilerTopFallback');
}
for (const score of [79, 0, 999.99, 1000, 1234.5, 10000, '1250.25']) {
  const box = display(score);
  assert.ok(box, `Top score frame missing for ${score}`);
  assert.equal(box.querySelector('.score').textContent, (Math.round(Number(score) * 100) / 100).toLocaleString());
  assert.equal(box.querySelector('.count').textContent, '15 次免遊');
}
for (const score of [NaN, Infinity, -1, 'invalid']) assert.equal(display(score), undefined);
console.log('PASS: actual toast/display functions render 0, small and thousands-separated scores; invalid values stay hidden.');
