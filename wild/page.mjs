// Status page of the wild colony (GET /). Polls /status every 3 s; texts come from the locale catalogs.
import { t } from '../bridge/i18n.mjs';

export function statusPage() {
  const L = {};
  for (const k of ['title', 'till', 'earned', 'spent', 'colonists', 'projects', 'events', 'chat', 'name', 'chatName', 'mode', 'task', 'hp', 'food', 'gear', 'stats', 'none', 'byHand', 'byCrew', 'done', 'mode.work', 'mode.home', 'mode.leaving', 'metrics', 'metricsLine', 'role']) L[k] = t(`wild.page.${k}`);
  for (const r of ['miner', 'lumberjack', 'farmer', 'hunter', 'guard', 'builder']) L[`role.${r}`] = t(`wild.role.${r}`);
  L.memory = t('wild.page.memory');
  L.totals = t('wild.page.totals');
  const houses = Object.fromEntries(['cabin', 'hut', 'chalet', 'farmhouse'].map((h) => [h, t(`wild.house.${h}`)]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.title)}</title>
<style>
:root{--bg:#f6f4ef;--fg:#1d2420;--mut:#6b746e;--card:#fff;--line:#e2ded4;--acc:#b5302a;--ok:#2f7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#161a18;--fg:#e8ebe6;--mut:#98a29b;--card:#202622;--line:#323a35;--acc:#e0645c;--ok:#5fbf86}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 8px}
.mut{color:var(--mut)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
.row{display:flex;gap:12px;flex-wrap:wrap}.kpi{font-size:22px;font-weight:600}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--mut);font-size:12px}.wrap{overflow-x:auto}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;min-width:120px}.bar i{display:block;height:100%;background:var(--ok)}
.log{font:12px ui-monospace,monospace;white-space:pre-wrap;max-height:260px;overflow:auto}
</style>
<h1>${esc(L.title)}</h1><div class="mut" id="mem"></div>
<div class="row"><div class="card"><div class="mut">${esc(L.till)}</div><div class="kpi" id="till">–</div><div class="mut" id="flow"></div></div>
<div class="card" style="flex:1"><div class="mut" id="totals"></div></div></div>
<h2>${esc(L.metrics)}</h2><div class="card mut" id="metrics"></div>
<h2>${esc(L.colonists)}</h2><div class="card wrap"><table id="cols"></table></div>
<h2>${esc(L.projects)}</h2><div class="card" id="proj"></div>
<div class="row"><div style="flex:1;min-width:280px"><h2>${esc(L.events)}</h2><div class="card log" id="ev"></div></div>
<div style="flex:1;min-width:280px"><h2>${esc(L.chat)}</h2><div class="card log" id="chat"></div></div></div>
<script>
const L=${JSON.stringify(L)},H=${JSON.stringify(houses)};
const e=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fill=(s,p)=>s.replace(/\\{(\\w+)\\}/g,(m,k)=>p[k]??m);
const tm=t=>new Date(t).toLocaleTimeString();
async function load(){
 let s;try{s=await (await fetch('/status')).json()}catch{return}
 document.getElementById('mem').textContent=fill(L.memory,{free:s.freeMemMB,rss:s.nodeRssMB,cap:s.poolCap});
 document.getElementById('till').textContent=s.treasury.credits.toFixed(1)+' Fr.';
 document.getElementById('flow').textContent=L.earned+' '+s.treasury.earned.toFixed(1)+' · '+L.spent+' '+s.treasury.spent.toFixed(1);
 const m=s.metrics||{};document.getElementById('metrics').textContent=fill(L.metricsLine,{brain:m.brain,hours:m.colonistHours,dph:m.deathsPerHour,food:m.foodCriticalPct,up:m.uptimePct,logs:(m.perHour||{}).logs,stone:(m.perHour||{}).stone,credits:(m.perHour||{}).credits});
 const st=s.stats||{};document.getElementById('totals').textContent=fill(L.totals,{kills:st.kills||0,deaths:st.deaths||0,rec:st.recoveries||0,crafted:st.crafted||0,gifts:st.gifts||0});
 const rows=s.colonists.map(c=>'<tr><td><b>'+e(c.name)+'</b>'+(c.helper?' ⚒':'')+'</td><td>'+e(c.chat||'')+'</td><td>'+e(L['mode.'+c.mode]||c.mode)+(c.boost?' ⚡'.repeat(c.boost):'')+'<br><span class="mut">'+e(L['role.'+c.role]||c.role||'')+'</span></td><td>'+e(c.task)+'</td><td>'+(c.dead?'☠':e(c.hp))+'</td><td>'+e(c.food)+'</td><td>'+e(c.tools.join(', '))+'<br><span class="mut">'+e(c.armor.join(', '))+(c.shield?', shield':'')+'</span></td><td class="mut">'+e(Object.entries(c.stats).filter(([,v])=>v).map(([k,v])=>k+' '+v).join(' · '))+'</td></tr>');
 document.getElementById('cols').innerHTML=s.colonists.length?'<tr><th>'+[L.name,L.chatName,L.mode,L.task,L.hp,L.food,L.gear,L.stats].map(e).join('</th><th>')+'</th></tr>'+rows.join(''):'<tr><td class="mut">'+e(L.none)+'</td></tr>';
 document.getElementById('proj').innerHTML=s.projects.map(p=>'<div style="margin:6px 0"><b>'+e(H[p.type]||p.label)+'</b> '+(p.done?'✓ '+e(L.done):p.placed+'/'+p.total)+' <span class="mut">('+p.hand+' '+e(L.byHand)+', '+p.rcon+' '+e(L.byCrew)+', '+p.credits.toFixed(1)+' Fr.)</span><div class="bar"><i style="width:'+(100*p.placed/Math.max(1,p.total)).toFixed(0)+'%"></i></div></div>').join('')||'–';
 document.getElementById('ev').textContent=s.events.slice().reverse().map(x=>tm(x.t)+'  '+x.text).join('\\n');
 document.getElementById('chat').textContent=s.chat.slice().reverse().map(x=>tm(x.t)+'  <'+x.who+'> '+x.text).join('\\n');
}
load();setInterval(load,3000);
</script>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
