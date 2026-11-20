const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(patch={}){
 const rows={bookings:[{id:'b',clientId:'c',stage:'enquiry',status:'open',eventDate:'2026-12-30',lines:[{name:'Makeup',qty:1,price:200}],...patch}],clients:[{id:'c',firstName:'Jess'}],payments:[],invoices:[],reminders:[],photos:[],reviews:[],activity:[]};let count=0,calls=[];
 const DB={get:(s,id)=>rows[s]?.find(x=>x.id===id),list:(s,f)=>rows[s]?.filter(f||(()=>true))||[],find:(s,f)=>rows[s]?.find(f),setting:()=>undefined,setSetting:async()=>{},uid:()=>String(++count),save:async(s,v)=>{v={id:v.id||String(++count),...v};const i=rows[s].findIndex(x=>x.id===v.id);if(i<0)rows[s].push(v);else rows[s][i]=v;return v},refresh:async()=>{},client:{functions:{invoke:async(n,v)=>{calls.push(v.body);return {data:{ok:true}}}}}};
 const values=new Map();
 const ctx={window:{Auth:{current:{id:'owner',role:'owner'}},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}},DB,UI:{money:n=>'$'+n,fmtDate:x=>x,fmtTime:x=>x,fmtDateTime:x=>x,today:()=> '2026-11-19',ymd:d=>new Date(d).toISOString().slice(0,10),parseYmd:d=>new Date(d),addDays:(d,n)=>new Date(+new Date(d)+n*86400000)}};vm.runInNewContext(fs.readFileSync('js/workflow.js','utf8'),ctx);return {W:ctx.window.Workflow,rows,b:rows.bookings[0],calls};
}
test('owner approval has no pre-call notes prerequisite',async()=>{const f=fixture({callAt:'2026-12-01T01:00:00Z'});await f.W.approveConsultation(f.b);assert.equal(f.calls[0].action,'approve');assert.ok(!f.b.enquiryReviewedAt)});
test('pending consultation cannot progress but CRM approval can without notes',()=>{const f=fixture({consultation:{provider:'crm',status:'pending'}});assert.equal(f.W.checkNext(f.b).ok,false);f.b.consultation.status='confirmed';assert.equal(f.W.checkNext(f.b).ok,true)});
test('future or unapproved calls cannot be logged',async()=>{let f=fixture({stage:'call'});await assert.rejects(f.W.logCall(f.b,'Notes'),/Approve/);f=fixture({stage:'call',callAt:'2099-12-01T01:00Z',consultation:{provider:'crm',status:'confirmed'}});await assert.rejects(f.W.logCall(f.b,'Notes'),/not started/)});
test('completed call saves notes and moves to initial quote',async()=>{const f=fixture({stage:'call',callAt:'2020-01-01T01:00Z',consultation:{provider:'crm',status:'confirmed'}});await f.W.logCall(f.b,'Soft glam, two people');assert.equal(f.rows.bookings[0].stage,'updates');assert.equal(f.rows.bookings[0].callNotes,'Soft glam, two people');assert.ok(f.rows.bookings[0].callLoggedAt)});
test('additional costs enter balance and final invoice after deposit deduction',async()=>{const f=fixture({stage:'invoice',additionalCosts:25,additionalCostsReason:'Extra lashes'});f.rows.payments.push({bookingId:'b',type:'deposit',amount:60});assert.equal(f.W.totals(f.b).balance,165);const inv=await f.W.ensureInvoice(f.b,'final');assert.equal(inv.total,165);assert.ok(inv.items.some(x=>x.desc==='Extra lashes'&&x.price===25))});
test('issued final invoices prevent additional cost changes',async()=>{const f=fixture({callLoggedAt:'2020-01-01'});f.rows.invoices.push({bookingId:'b',type:'final',stripeInvoiceId:'in_1'});await assert.rejects(f.W.saveBooking(f.b,{additionalCosts:25,additionalCostsReason:'Extra'}),/Reconcile/)});
test('follow-up uses paid Stripe invoice and is required before completion',async()=>{const f=fixture({stage:'review'});f.rows.invoices.push({bookingId:'b',type:'final',stripeUrl:'https://invoice.stripe.com/i/test'});f.rows.payments.push({bookingId:'b',amount:200,type:'final'});f.rows.reviews.push({bookingId:'b'});const msg=f.W.renderTemplate('service_followup',f.b);assert.match(msg.body,/paid in full/);assert.match(msg.body,/https:\/\/invoice.stripe.com/);assert.equal(f.W.checkNext(f.b).ok,false);await f.W.logMessage(f.b,'service_followup',msg.subject,'email');assert.equal(f.W.checkNext(f.b).ok,true)});
test('completing a call with blank notes saves an edited ready-by time and preserves existing notes', async () => {
  const f = fixture({stage:'call',callAt:'2020-01-01T01:00Z',consultation:{provider:'crm',status:'confirmed'},readyBy:'13:00',callNotes:'Existing notes'});
  await f.W.logCall(f.b, '  ', {readyBy:'14:30'});
  assert.equal(f.rows.bookings[0].readyBy,'14:30');
  assert.equal(f.rows.bookings[0].callNotes,'Existing notes');
  assert.equal(f.rows.bookings[0].stage,'updates');
});

test('developer mode skips consult and event waits while preserving approval',async()=>{
 const f=fixture({stage:'call',callAt:'2099-01-01T01:00Z',consultation:{provider:'crm',status:'pending'}});
 assert.equal(f.W.developerModeEnabled(),false);
 f.W.setDeveloperMode(true);
 await assert.rejects(()=>f.W.logCall(f.b,''),/Approve/);
 f.b.consultation.status='confirmed';
 await f.W.logCall(f.b,'');
 assert.equal(f.rows.bookings[0].stage,'updates');
 const booking=fixture({stage:'booked',eventDate:'2099-01-02'});
 assert.equal(booking.W.checkNext(booking.b).ok,false);
 booking.W.setDeveloperMode(true);
 assert.equal(booking.W.checkNext(booking.b).ok,true);
 booking.W.setDeveloperMode(false);
 assert.equal(booking.W.checkNext(booking.b).ok,false);
});
