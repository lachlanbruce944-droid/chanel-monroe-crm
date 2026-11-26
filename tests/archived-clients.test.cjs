const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('js/app.js','utf8'),block=src.slice(src.indexOf('  function viewClients('),src.indexOf('  function viewClient('));
function screen(){
 const bookings=[{id:'a',clientId:'archived',archivedAt:'2026-11-26'},{id:'b',clientId:'mixed',archivedAt:'2026-11-26'},{id:'c',clientId:'mixed'}];
 const rows={clients:['archived','mixed','new'].map(id=>({id,firstName:id})),bookings,payments:[]};
 const ctx={DB:{list:(k,f)=>rows[k].filter(f||(()=>true))},W:{clientName:c=>c.firstName},esc:String,icon:()=>'',money:String,clientPortrait:()=>'',stageBadge:()=>'',empty:msg=>msg};vm.createContext(ctx);vm.runInContext(block,ctx);return {view:ctx.viewClients,bookings};
}
test('Archived contains only clients whose bookings are all archived',()=>{const f=screen(),active=f.view().html,archived=f.view(true).html;assert.ok(!active.includes('#/client/archived'));assert.ok(active.includes('#/client/mixed'));assert.ok(active.includes('#/client/new'));assert.ok(archived.includes('#/client/archived'));assert.ok(!archived.includes('#/client/mixed'));assert.ok(!archived.includes('#/client/new'));assert.match(archived,/Client views/)});
test('restoring a booking returns its client to Active',()=>{const f=screen();f.bookings[0].archivedAt=null;assert.ok(f.view().html.includes('#/client/archived'));assert.ok(!f.view(true).html.includes('#/client/archived'))});
