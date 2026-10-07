import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlan } from './plan.mjs';
const data=JSON.parse(readFileSync(new URL('./personnel.json',import.meta.url)));
test('36 people, 35 assignments and two titles for Hoang Kim',()=>{
 const p=buildPlan(data,[],[]);
 assert.equal(p.records.length,36);assert.equal(p.departments.length,9);
 assert.equal(p.records.reduce((n,r)=>n+r.assignments.length,0),35);
 assert.equal(p.records.find(r=>r.employee.id==='TL.PGD-TPKD.002').assignments.length,2);
 assert.equal(p.records.filter(r=>!r.assignments.length).length,2);
 assert.equal(p.records.filter(r=>r.role==='Director').length,1);
 assert.equal(p.records.filter(r=>r.role==='Manager').length,4);
 assert.equal(p.records.filter(r=>r.role==='Employee').length,31);
 assert.equal(p.records.find(r=>r.employee.id==='TL.GD.001').role,'Director');
 for (const id of ['TL.KTT.005','TL.PGD-TPKD.002','TL.TPKTBH.015','TL.TPMKT.021']) {
  assert.equal(p.records.find(r=>r.employee.id===id).role,'Manager');
 }
});
test('retain legacy user ID when email changed; plan retains role/password object',()=>{
 const old={id:'u3',name:'Phan Xuân Mạnh',email:'xuanmanh@tranlecorp.com.vn',role:'Employee',password:'existing',department:'Legacy'};
 const r=buildPlan(data,[old],[]).records.find(r=>r.employee.full_name===old.name);
 assert.equal(r.id,'u3');assert.equal(r.existing,old);assert.equal(r.employee.email,'manhpx@tranlecorp.com.vn');
});
test('conflicting email and name accounts abort import',()=>{
 assert.throws(()=>buildPlan(data,[{id:'a',name:'Someone else',email:'manhpx@tranlecorp.com.vn'},{id:'b',name:'Phan Xuân Mạnh',email:'other@example.com'}],[]),/different accounts/);
});
test('matched Admin accounts are never downgraded by personnel role mapping',()=>{
 const admin={id:'admin-1',name:'Phan Xuân Mạnh',email:'manhpx@tranlecorp.com.vn',role:'Admin'};
 assert.throws(()=>buildPlan(data,[admin],[]),/Refusing to downgrade Admin/);
});
test('repeat import matches stable codes and keeps department IDs',()=>{
 const first=buildPlan(data,[],[]);
 const users=first.records.map(r=>({id:r.id,name:r.employee.full_name,email:r.employee.email,employeeCode:r.employee.id,department:r.department}));
 const deps=first.departments.map(d=>({id:d.dbId,name:d.name}));
 const second=buildPlan(data,users,deps);
 assert.ok(second.records.every(r=>r.existing));assert.deepEqual(second.records.map(r=>r.id),first.records.map(r=>r.id));
});
test('department ID collision aborts instead of renaming unrelated department',()=>{
 assert.throws(()=>buildPlan(data,[],[{id:'tle-dept-bgd',name:'Unrelated department'}]),/Department ID collision/);
});
