const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('supabase/functions/crm-email/index.ts','utf8');
function runtime(){let handler;const ctx={Deno:{env:{get:()=>undefined},serve:h=>handler=h},Response,URL,AbortSignal,crypto:require('node:crypto').webcrypto,TextEncoder,fetch:async()=>{throw Error('Unexpected external request')}};vm.createContext(ctx);vm.runInContext(source,ctx);return {handler,ctx};}
test('unauthenticated callers cannot read connector state',async()=>{const {handler}=runtime();const r=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'status'})}));assert.equal(r.status,401)});
test('scheduled key cannot grant access when not configured',async()=>{const {handler}=runtime();const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{'x-crm-mail-key':'invented'},body:JSON.stringify({action:'sync'})}));assert.equal(r.status,401)});
test('Graph token never goes to an untrusted URL',async()=>{const {ctx}=runtime();await assert.rejects(vm.runInContext("graph('https://example.invalid/v1.0/users/x','secret')",ctx),/Invalid Microsoft sync URL/)});
test('email UI escapes message content and rejects outside Outlook links',()=>{const w={},ctx={window:w,UI:{esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),fmtDateTime:s=>s},document:{addEventListener(){}},URL,DB:{missing:{},list:()=>[{id:'test',bookingId:'booking',receivedAt:'2026-11-21',subject:'<script>',bodyText:'<img src=x onerror=alert(1)>',webLink:'https://example.invalid'}]}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/email-connector.js','utf8'),ctx);const html=w.EmailConnector.bookingPanel({id:'booking'});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('href="https://example.invalid'))});
test('all modified browser scripts parse',()=>{for(const p of ['js/email-connector.js','js/connectors.js','js/db.js','js/app.js'])new vm.Script(fs.readFileSync(p,'utf8'))});

test('profile message log includes all linked messages and offers saving even after review',()=>{
 const w={},ctx={window:w,UI:{esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),fmtDateTime:s=>s},document:{addEventListener(){}},URL,DB:{missing:{},list:()=>[
 {id:'one',clientId:'client',receivedAt:'2026-11-26',reviewedAt:'2026-11-26',subject:'Reviewed email',bodyText:'<unsafe>'},
 {id:'two',clientId:'other',receivedAt:'2026-11-26',subject:'Unrelated email'}]}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/email-connector.js','utf8'),ctx);
 const html=w.EmailConnector.clientPanel({id:'client'});assert.ok(html.includes('Reviewed email'));assert.ok(html.includes('Save details to profile'));assert.ok(!html.includes('Unrelated email'));assert.ok(html.includes('&lt;unsafe>'));
});
test('saving profile details uses an authenticated atomic RPC and retains source audit',()=>{
 const sql=fs.readFileSync('supabase/email_profile_details.sql','utf8');
 assert.ok(sql.includes('security invoker'));assert.ok(sql.includes("role='owner'"));assert.ok(sql.includes('for update'));assert.ok(sql.includes("type='email_profile_detail'"));assert.ok(sql.includes("'emailId',m.id"));assert.ok(sql.includes('revoke all'));assert.ok(!sql.includes('update crm_bookings'));
});
