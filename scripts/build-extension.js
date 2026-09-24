'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const runtimeDir = path.join(root, 'extension', 'runtime');

function readEngine(file, globalName) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, file), 'utf8'), context, { filename: file });
  const source = context.window[globalName];
  if (typeof source !== 'string' || source.length < 1000) throw new Error(file + ' did not expose ' + globalName);
  return source;
}

function extractTemplate(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Missing ' + marker);
  const bodyStart = start + marker.length;
  let end = bodyStart;
  for (;;) {
    end = source.indexOf('`', end);
    if (end < 0) throw new Error('Unterminated template: ' + marker);
    let slashCount = 0;
    for (let i = end - 1; i >= 0 && source[i] === '\\'; i--) slashCount++;
    if (slashCount % 2 === 0) break;
    end++;
  }
  const literal = source.slice(bodyStart, end);
  return vm.runInNewContext('`' + literal + '`');
}

fs.mkdirSync(runtimeDir, { recursive: true });
const atg = readEngine('engine-code.js', 'SETH_ENGINE_SRC');
const thor = readEngine('thor-engine-code.js', 'THOR_ENGINE_SRC');
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
let overlay = extractTemplate(app, 'const SCARAB_OVERLAY_SRC = `');

const oldGo = "function goCmd(url){if(window.__SCARAB_PROXY_PREFIX&&window.parent&&window.parent!==window){try{window.parent.postMessage({__scarabCommand:true,url:url},location.origin);return}catch(e){}}location.href=url}";
const newGo = "function goCmd(url){if(window.opener&&!window.opener.closed){try{window.opener.postMessage({__scarabCommand:true,url:url},'*');setTimeout(function(){try{window.close()}catch(_){}},30);return}catch(e){}}if(window.__SCARAB_RETURN_URL){try{location.href=window.__SCARAB_RETURN_URL+'#scarab_command='+encodeURIComponent(url);return}catch(e){}}if(window.__SCARAB_PROXY_PREFIX&&window.parent&&window.parent!==window){try{window.parent.postMessage({__scarabCommand:true,url:url},location.origin);return}catch(e){}}location.href=url}";
if (!overlay.includes(oldGo)) throw new Error('Overlay goCmd signature changed');
overlay = overlay.replace(oldGo, newGo);

fs.writeFileSync(path.join(runtimeDir, 'atg-engine-runtime.js'), '/* Generated from public/engine-code.js. */\n' + atg + '\n');
fs.writeFileSync(path.join(runtimeDir, 'thor-engine-runtime.js'), '/* Generated from public/thor-engine-code.js. */\n' + thor + '\n');
fs.writeFileSync(path.join(runtimeDir, 'overlay-runtime.js'), '/* Generated from SCARAB_OVERLAY_SRC. */\nif(window.__SCARAB_WEB_ACTIVE){\n' + overlay + '\n}\n');

console.log('Chrome extension runtime built:', {
  atg: atg.length,
  thor: thor.length,
  overlay: overlay.length
});
