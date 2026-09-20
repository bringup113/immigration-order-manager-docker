import test from 'node:test';
import assert from 'node:assert/strict';
import {dateAfter,rebaseTemplateDates} from '../lib/order-template-dates.ts';
test('contract date determines template dates across leap years and year boundaries',()=>{
 assert.equal(dateAfter('2024-02-28',2),'2024-03-01');
 assert.equal(dateAfter('2025-12-31',1),'2026-01-01');
 assert.equal(dateAfter('2020-01-01',0),'2020-01-01');
 assert.equal(dateAfter('',7),'');assert.equal(dateAfter('2026-09-15',null),'');
});
test('changing contract date rebases templates but preserves manual dates and clears automatic dates for blank input',()=>{
 const rows=[{dueDate:'2026-09-22',dueDays:7,dueDateMode:'template'}, {dueDate:'2027-01-01',dueDays:7,dueDateMode:'manual'}, {dueDate:'2026-11-01'}];
 const result=rebaseTemplateDates(rows,'2025-12-31');
 assert.equal(result[0].dueDate,'2026-01-07');assert.equal(result[1].dueDate,'2027-01-01');assert.equal(result[2].dueDate,'2026-11-01');
 assert.equal(rows[0].dueDate,'2026-09-22');assert.equal(rebaseTemplateDates(rows,'')[0].dueDate,'');
});
