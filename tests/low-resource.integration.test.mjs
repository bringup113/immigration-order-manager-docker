import assert from 'node:assert/strict';
import test from 'node:test';
import {rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';

const base=process.env.MIGRA_BASE_URL;
const databaseUrl=process.env.MIGRA_DATABASE_URL;
const username=process.env.MIGRA_TEST_USERNAME;
const password=process.env.MIGRA_TEST_PASSWORD;
const enabled=Boolean(base && databaseUrl && username && password);

test('low-resource search, pagination, transaction and streaming regressions',{skip:!enabled,timeout:120000},async t=>{
 const login=await fetch(base+'/api/auth/login',{method:'POST',body:new URLSearchParams({username,password}),redirect:'manual'});
 assert.equal(login.status,303);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const sql=new pg.Client({connectionString:databaseUrl});await sql.connect();
 const suffix=randomUUID().replaceAll('-','').slice(0,12);
 const marker='全订单测试'+suffix;
 const orderIds=[],extraAgents=[],extraProjects=[];let agent,project;
 const headers={cookie,'content-type':'application/json'};
 const get=async(path)=>{const response=await fetch(base+path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const post=async(path,body,status=200)=>{const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 const waitSearch=async(term,predicate)=>{
   const until=Date.now()+20000;
   while(Date.now()<until){const data=await get('/api/data/search?q='+encodeURIComponent(term));if(predicate(data))return data;await new Promise(resolve=>setTimeout(resolve,100));}
   assert.fail('Search index did not converge: '+term);
 };
 try {
   agent=await post('/api/data/agents',{name:marker+'核心代理'},201);
   project=await post('/api/data/projects',{name:marker+'项目',country:'测试国',code:'LR'+suffix.toUpperCase()},201);
   const create=async(includeLargeMaterialSet=true)=>{
    const order=await post('/api/data/orders',{agentId:agent.id,projectId:project.id,status:'DRAFT',signedAt:'2026-09-10',notes:marker,
      applicants:[{name:'张三'+suffix,passportNo:'PASS'+suffix,nationality:'CHN',birthDate:'1990-01-01',passportExpiry:'2035-01-01',applicantType:'MAIN'}],
      steps:[{name:marker+'办理',required:true},{name:'后续步骤',required:true}],
      plans:[{name:marker+'费用',planType:'RECEIVABLE',currency:'USD',amount:'123.45'}],
      materials:includeLargeMaterialSet?Array.from({length:105},(_,i)=>({name:marker+'材料'+i,scope:'COMMON',required:false})):[]},201);
    orderIds.push(order.id);return order;
   };
   const order=await create();const second=await create();
   for(let index=0;index<11;index+=1)await create(false);
   for(let index=0;index<8;index+=1){
     extraAgents.push(await post('/api/data/agents',{name:`${marker}代理分页${index}`},201));
     extraProjects.push(await post('/api/data/projects',{name:`${marker}项目分页${index}`,country:'测试国',code:`PG${index}${suffix.toUpperCase()}`},201));
   }
   const path='/api/orders/'+order.orderNo;
   let detail=await get(path);
   await t.test('bulk order inserts retain every material and planned amount',()=>{
    assert.equal(detail.materials.filter(item=>item.system_code==='PASSPORT_BIO_PAGE').length,1);
    assert.equal(detail.materials.filter(item=>item.system_code===null).length,105);
    assert.equal(detail.materials.length,106);assert.equal(detail.plans.length,1);assert.equal(Number(detail.plans[0].planned_base_minor),12345);
   });
   await sql.query(`INSERT INTO order_progress(id,order_id,progress_date,title,details,follow_up_done,pinned,created_at)
    SELECT $1||n,$2,CURRENT_DATE,$3||n,$4,1,0,now()+n*interval '1 second' FROM generate_series(1,65) n`,['lr_progress_'+suffix,order.id,marker+'跟进','深层备注'+suffix]);
   await t.test('all order sources remain searchable without rebuilding on each read',async()=>{
     for(const term of [marker+'材料104','PASS'+suffix,marker+'办理',marker+'费用','深层备注'+suffix,'zhangsan'+suffix])
       await waitSearch(term,data=>data.orders.some(row=>row.order_no===order.orderNo));
     await waitSearch(marker+'核心代理',data=>data.agents.some(row=>row.id===agent.id));
     const before=await sql.query('SELECT updated_at FROM order_search_index WHERE order_id=$1',[order.id]);
     await get('/api/data/search?q='+encodeURIComponent(marker));await get('/api/data/search?q='+encodeURIComponent(marker));
     const after=await sql.query('SELECT updated_at FROM order_search_index WHERE order_id=$1',[order.id]);
     assert.equal(String(before.rows[0].updated_at),String(after.rows[0].updated_at));
     const escaped=await get('/api/data/search?q='+encodeURIComponent('%UNMATCHED_'+suffix));assert.equal(escaped.orders.length,0);
     const separators=await get('/api/data/search?q='+encodeURIComponent('+'));assert.deepEqual({orders:separators.orders,projects:separators.projects,agents:separators.agents},{orders:[],projects:[],agents:[]});
   });
   await t.test('grouped search pages beyond desktop defaults without duplicates',async()=>{
     const defaults=await waitSearch(marker,data=>data.orders.length===12&&data.pagination?.orders?.hasMore&&data.projects.length===8&&data.pagination?.projects?.hasMore&&data.agents.length===8&&data.pagination?.agents?.hasMore);
     assert.equal(defaults.pagination.orders.pageSize,12);assert.equal(defaults.pagination.projects.pageSize,8);assert.equal(defaults.pagination.agents.pageSize,8);
     const orderPages=[];
     for(let page=1;page<=3;page+=1)orderPages.push(await get('/api/data/search?q='+encodeURIComponent(marker)+`&group=orders&page=${page}&pageSize=5`));
     assert.deepEqual(orderPages.map(item=>item.orders.length),[5,5,3]);assert.deepEqual(orderPages.map(item=>item.pagination.orders.hasMore),[true,true,false]);
     assert.equal(new Set(orderPages.flatMap(item=>item.orders.map(row=>row.order_no))).size,13);
     assert.ok(orderPages.every(item=>item.projects.length===0&&item.agents.length===0&&!item.pagination.projects.loaded&&!item.pagination.agents.loaded));
     const projectTail=await get('/api/data/search?q='+encodeURIComponent(marker)+'&group=projects&page=3&pageSize=4');
     const agentTail=await get('/api/data/search?q='+encodeURIComponent(marker)+'&group=agents&page=3&pageSize=4');
     assert.equal(projectTail.projects.length,1);assert.equal(projectTail.pagination.projects.hasMore,false);
     assert.equal(agentTail.agents.length,1);assert.equal(agentTail.pagination.agents.hasMore,false);
     for(const group of ['projects','agents']){
       const pages=await Promise.all([1,2,3].map(page=>get('/api/data/search?q='+encodeURIComponent(marker)+`&group=${group}&page=${page}&pageSize=4`)));
       const ids=pages.flatMap(item=>item[group].map(row=>row.id));
       assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);
       assert.deepEqual(pages.map(item=>item.pagination[group].hasMore),[true,true,false]);
     }
   });
   await t.test('server paging is stable and includes orders beyond the first page',async()=>{
     const first=await get('/api/data/orders?pageSize=1&q='+encodeURIComponent(marker));
     const next=await get('/api/data/orders?pageSize=1&page=2&q='+encodeURIComponent(marker));
     assert.equal(first.rows.length,1);assert.equal(first.hasMore,true);assert.equal(next.rows.length,1);assert.notEqual(first.rows[0].id,next.rows[0].id);
     assert.ok(orderIds.includes(first.rows[0].id));assert.ok(orderIds.includes(next.rows[0].id));
     const page1=await get(path+'?section=workflow');const page2=await get(path+'?section=workflow&historyPage=2');
     assert.equal(page1.progress.length,50);assert.equal(page1.historyHasMore,true);assert.equal(page2.progress.length,16);
     assert.equal(new Set([...page1.progress,...page2.progress].map(row=>row.id)).size,66);
     assert.deepEqual(page1.materialFiles,[]);assert.deepEqual(page1.cashEntries,[]);assert.deepEqual(page1.closureCheck,{});
   });
   await t.test('single-pool-connection writes and conflicts complete without hanging',async()=>{
     detail=await get(path);
     const responses=await Promise.all(Array.from({length:5},(_,i)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify({action:'updateNotes',notes:marker+'并发'+i,expectedVersion:detail.order.version}),signal:AbortSignal.timeout(10000)})));
     assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,4);
     const changed=await get(path);assert.equal(changed.order.version,detail.order.version+1);
   });
   await t.test('agent changes invalidate all affected orders',async()=>{
     await post('/api/data/agents',{action:'update',id:agent.id,name:'新代理'+suffix});
     await waitSearch('新代理'+suffix,data=>data.orders.some(row=>row.order_no===order.orderNo)&&data.orders.some(row=>row.order_no===second.orderNo));
   });
   await t.test('streaming upload validates boundaries and PDF byte ranges',async()=>{
     const content=Buffer.alloc(20*1024*1024,0x61);content.write('%PDF-1.4\n');
     const upload=async(buffer,extra={})=>{const form=new FormData();form.set('orderNo',order.orderNo);form.set('materialId',detail.materials[0].id);form.set('file',new Blob([buffer]),'测试.pdf');for(const [key,value] of Object.entries(extra))form.set(key,value);return fetch(base+'/api/material-files',{method:'POST',headers:{cookie},body:form});};
     const valid=await upload(content);assert.equal(valid.status,201,await valid.clone().text());const file=await valid.json();
     const dbFile=await sql.query('SELECT sha256,size_bytes FROM material_files WHERE id=$1',[file.id]);assert.equal(dbFile.rows[0].sha256,createHash('sha256').update(content).digest('hex'));assert.equal(Number(dbFile.rows[0].size_bytes),content.length);
     const ranged=await fetch(base+'/api/material-files/'+file.id,{headers:{cookie,range:'bytes=0-7'}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),`bytes 0-7/${content.length}`);assert.equal(await ranged.text(),'%PDF-1.4');
     const suffixRange=await fetch(base+'/api/material-files/'+file.id,{headers:{cookie,range:'bytes=-4'}});assert.equal(suffixRange.status,206);assert.equal(await suffixRange.text(),'aaaa');
     const invalid=await fetch(base+'/api/material-files/'+file.id,{headers:{cookie,range:'bytes=999999999-'}});assert.equal(invalid.status,416);
     const tooLarge=await upload(Buffer.concat([content,Buffer.from('a')]));assert.equal(tooLarge.status,413,await tooLarge.clone().text());
     const invalidFormat=await upload(Buffer.from('not a material'));assert.equal(invalidFormat.status,400);
     const replacement=await upload(Buffer.from('%PDF-1.4\nreplacement'),{replaceFileId:file.id,reason:'替换测试'});assert.equal(replacement.status,201,await replacement.clone().text());
     await waitSearch('替换测试',data=>data.orders.some(row=>row.order_no===order.orderNo));
   });
   await t.test('catalogs defer all project templates until a project is selected',async()=>{
     const light=await get('/api/data/catalogs');assert.deepEqual(light.projectSteps,[]);assert.deepEqual(light.projectPlans,[]);assert.deepEqual(light.projectMaterials,[]);
     const selected=await get('/api/data/catalogs?projectId='+project.id);assert.ok(Array.isArray(selected.projectSteps));
   });
 } finally {
   for(const id of orderIds) {
     if(process.env.MIGRA_TEST_UPLOAD_ROOT) {
       const files=await sql.query('SELECT relative_path FROM material_files WHERE order_id=$1',[id]);
       const root=resolve(process.env.MIGRA_TEST_UPLOAD_ROOT);
       for(const file of files.rows) {const path=resolve(root,file.relative_path);if(path.startsWith(root+sep))await rm(path,{force:true});}
     }
     await sql.query('DELETE FROM orders WHERE id=$1',[id]);
   }
   for(const item of extraProjects)await sql.query('DELETE FROM projects WHERE id=$1',[item.id]);
   for(const item of extraAgents)await sql.query('DELETE FROM agents WHERE id=$1',[item.id]);
   if(project)await sql.query('DELETE FROM projects WHERE id=$1',[project.id]);
   if(agent)await sql.query('DELETE FROM agents WHERE id=$1',[agent.id]);
   await sql.end();
 }
});
