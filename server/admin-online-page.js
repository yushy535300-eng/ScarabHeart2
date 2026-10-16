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
var admin_online_page_exports = {};
__export(admin_online_page_exports, {
  adminOnlinePage: () => adminOnlinePage
});
module.exports = __toCommonJS(admin_online_page_exports);
function adminOnlinePage(appId) {
  const programs = [
    { id: "scarab-heart", label: "\u8056\u7532\u4E4B\u5FC3\u52A9\u624B", image: "scarab", accent: "scarab" },
    { id: "autobac", label: "\u767E\u5BB6\u81EA\u52D5\u4E0B\u6CE8", image: "autobac", accent: "autobac" },
    { id: "baccarat-helper", label: "\u591A\u5E73\u53F0\u767E\u5BB6\u8F14\u52A9", image: "helper", accent: "helper" }
  ];
  const selected = programs.find((program) => program.id === appId);
  if (!selected) throw new Error("invalid_presence_app");
  const sections = [selected].map((program) => `<section class="roster-card ${program.accent}" aria-labelledby="heading-${program.id}">
    <div class="roster-heading"><img src="/admin-brand-v3215/${program.image}.png" alt="" width="48" height="48"><h2 id="heading-${program.id}">${program.label}</h2></div>
    <p class="roster-count"><strong id="online-count-${program.id}">\u5F85\u540C\u6B65</strong><span>\u4EBA\u5728\u7DDA</span></p>
    <div id="online-list-${program.id}" class="roster-users">\u5F85\u540C\u6B65</div>
  </section>`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${selected.label}\u6703\u54E1\u540D\u55AE\uFF5C\u767D\u540D\u55AE\u7BA1\u7406</title><link rel="icon" href="/admin-icon-192.png"><link rel="stylesheet" href="/admin-brand-v3220.css"></head>
  <body class="online-page"><main class="wrap"><header class="online-page-top"><div><p class="online-page-eyebrow">\u767D\u540D\u55AE\u7BA1\u7406</p><h1>${selected.label}\u6703\u54E1\u540D\u55AE</h1></div><a class="online-back" href="/admin">\u8FD4\u56DE\u7BA1\u7406\u9996\u9801</a></header><p id="roster-status" class="roster-status" role="status">\u6B63\u5728\u8B80\u53D6\u5728\u7DDA\u5E33\u865F\u2026</p><div class="roster-sections single-roster">${sections}</div></main>
  <script>
  const knownIds=['scarab-heart','autobac','baccarat-helper'];
  const appIds=${JSON.stringify([selected.id])};
  function validCount(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
  function clearLists(){for(const id of appIds){const list=document.getElementById('online-list-'+id);list.textContent='\u5F85\u540C\u6B65';delete list.dataset.signature;}}
  function unavailable(){for(const id of appIds)document.getElementById('online-count-'+id).textContent='\u5F85\u540C\u6B65';clearLists();document.getElementById('roster-status').textContent='\u8CC7\u6599\u5C1A\u672A\u540C\u6B65';}
  function showPresence(data){
    if(!data||data.ok!==true||!Array.isArray(data.applications))throw Error('unavailable');
    const sites=new Map();for(const site of data.applications){if(!site||!knownIds.includes(site.appId)||sites.has(site.appId)||!validCount(site.onlineAccounts))throw Error('unavailable');sites.set(site.appId,site);}
    if(sites.size!==knownIds.length)throw Error('unavailable');
    for(const id of appIds)document.getElementById('online-count-'+id).textContent=String(sites.get(id).onlineAccounts);
    if(!Array.isArray(data.onlineUsers)){clearLists();document.getElementById('roster-status').textContent='\u5E33\u865F\u540D\u55AE\u5F85\u540C\u6B65';return;}
    const groups=new Map(knownIds.map(id=>[id,[]])),keys=new Set();
    for(const user of data.onlineUsers){
      if(!user||!groups.has(user.appId)||typeof user.platform!=='string'||!user.platform.trim()||typeof user.username!=='string'||!user.username.trim()||user.platform.length>16||user.username.length>128)throw Error('unavailable');
      const key=JSON.stringify([user.appId,user.platform.toUpperCase(),user.username.toLowerCase()]);if(keys.has(key))throw Error('unavailable');keys.add(key);groups.get(user.appId).push(user);
    }
    for(const [id,users]of groups)if(users.length!==sites.get(id).onlineAccounts)throw Error('unavailable');
    for(const [id,users]of groups){
      if(!appIds.includes(id))continue;
      const container=document.getElementById('online-list-'+id),signature=JSON.stringify(users);if(container.dataset.signature===signature)continue;
      const fragment=document.createDocumentFragment();
      if(!users.length){const empty=document.createElement('p');empty.className='online-empty';empty.textContent='\u76EE\u524D\u7121\u5728\u7DDA\u5E33\u865F';fragment.append(empty);}
      for(const user of users){const row=document.createElement('div');row.className='online-user';const name=document.createElement('span');name.className='online-user-name';name.textContent=user.username;name.title=user.username;const platform=document.createElement('span');platform.className='online-user-platform';platform.textContent=user.platform;row.append(name,platform);fragment.append(row);}
      container.replaceChildren(fragment);container.dataset.signature=signature;
    }
    document.getElementById('roster-status').textContent='';
  }
  let busy=false;
  async function refreshOnline(){if(busy)return;busy=true;try{const response=await fetch('/api/admin/presence',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('unavailable');showPresence(await response.json());}catch{unavailable();}finally{busy=false;}}
  refreshOnline();setInterval(()=>{if(!document.hidden)refreshOnline();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOnline();});
  </script></body></html>`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adminOnlinePage
});
