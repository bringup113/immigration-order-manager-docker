import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
for(const scenario of ['clean','missing','voided-missing','orphan','hash','checksum','size'])test('attachment integrity: '+scenario,()=>{
 const root=mkdtempSync(join(tmpdir(),'migra-integrity-'));
 try{
  mkdirSync(join(root,'node_modules/pg'),{recursive:true});mkdirSync(join(root,'files'));
  writeFileSync(join(root,'node_modules/pg/package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
  writeFileSync(join(root,'node_modules/pg/index.js'),`export default {Client:class {async connect(){} async end(){} async query(){return {rows:JSON.parse(process.env.FIXTURE_ROWS)}}}};`);
  copyFileSync(resolve('scripts/check-file-integrity.mjs'),join(root,'check.mjs'));
  const content='fixture';const row={id:'file1',relative_path:'file.pdf',stored_name:'file.pdf',size_bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),status:scenario==='voided-missing'?'VOIDED':'ACTIVE'};
  if(!['missing','voided-missing'].includes(scenario))writeFileSync(join(root,'files/file.pdf'),scenario==='hash'?'changed':content);
  if(scenario==='orphan')writeFileSync(join(root,'files/orphan.pdf'),'orphan');
  if(scenario==='checksum')row.sha256=null;
  if(scenario==='size')row.size_bytes=99;
  const result=spawnSync(process.execPath,[join(root,'check.mjs')],{encoding:'utf8',env:{...process.env,DATABASE_URL:'mock://isolated',UPLOAD_ROOT:join(root,'files'),FIXTURE_ROWS:JSON.stringify([row])}});
  assert.equal(result.status,['clean','voided-missing'].includes(scenario)?0:2,result.stderr);
  const report=JSON.parse(result.stdout);const key={missing:'missingFiles',orphan:'orphanFiles',hash:'hashMismatches',checksum:'missingChecksums',size:'sizeMismatches'}[scenario];
  if(key)assert.equal(report.summary[key],1);
  if(scenario==='voided-missing')assert.deepEqual({active:report.summary.activeDatabaseRecords,historical:report.summary.historicalDatabaseRecords,missing:report.summary.missingFiles},{active:0,historical:1,missing:0});
 }finally{rmSync(root,{recursive:true,force:true});}
});
