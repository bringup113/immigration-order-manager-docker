import fs from 'node:fs';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
import {performance} from 'node:perf_hooks';
const base='http://127.0.0.1:3310';
const username=process.env.MIGRA_TEST_USERNAME,password=process.env.MIGRA_TEST_PASSWORD;if(!username||!password)throw Error('Set MIGRA_TEST_USERNAME and MIGRA_TEST_PASSWORD');
const login=await fetch(base+'/api/auth/login',{method:'POST',body:new URLSearchParams({username,password}),redirect:'manual'});
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');if(!cookie)throw Error('login failed');
const paths=['/api/data/orders','/api/data/orders?page=80','/api/data/search?q=needle2999','/api/data/search?q='+encodeURIComponent('材料'),'/api/data/search?q=zhangsan2999','/api/orders/LOAD-002999?section=workflow','/api/orders/LOAD-002999?section=finance','/api/data/dashboard'];
const results=[];
const snapshot=async()=>(await execute('docker',['stats','--no-stream','--format','{{.Name}} {{.MemUsage}} {{.CPUPerc}}','migra-loadtest-app','migra-loadtest-db'],{encoding:'utf8'})).stdout.trim();
const queue=()=>Number(execFileSync('docker',['exec','migra-loadtest-db','psql','-U','postgres','-d','loadtest','-Atc','SELECT count(*) FROM search_jobs'],{encoding:'utf8'}).trim());
async function run(concurrency,seconds,label){
const start=performance.now(),end=start+seconds*1000;const timings=[];const errors={};const byPath={};let i=0;const samples=[];
const timer=setInterval(()=>{snapshot().then(s=>samples.push(s)).catch(()=>{})},5000);
await Promise.all(Array.from({length:concurrency},async()=>{while(performance.now()<end){const path=paths[i++%paths.length];const t=performance.now();try{const r=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(20000)});await r.arrayBuffer();if(r.status!==200)errors[r.status]=(errors[r.status]||0)+1;}catch(e){errors[e.name]=(errors[e.name]||0)+1;}const ms=performance.now()-t;timings.push(ms);(byPath[path]??=[]).push(ms);}}));clearInterval(timer);
const summary=values=>{values.sort((a,b)=>a-b);return {count:values.length,p50:Math.round(values[Math.floor(values.length*.5)]),p95:Math.round(values[Math.floor(values.length*.95)]),max:Math.round(values.at(-1))}};
const result={label,concurrency,seconds:Math.round((performance.now()-start)/1000),...summary(timings),rps:+(timings.length/((performance.now()-start)/1000)).toFixed(1),errors,byPath:Object.fromEntries(Object.entries(byPath).map(([k,v])=>[k,summary(v)])),samples,pending:queue()};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync('docs/PERFORMANCE_RESULTS_2026-09-11.json',JSON.stringify(results,null,2));
}
await run(5,20,'indexing');
const deadline=Date.now()+600000;while(queue()>0){if(Date.now()>deadline)throw Error('Index queue not drained in 10 minutes');console.log('Pending index jobs: '+queue());await new Promise(r=>setTimeout(r,15000));}
const search=await fetch(base+'/api/data/search?q=deep2999',{headers:{cookie}}).then(r=>r.json());if(!search.orders.some(o=>o.order_no==='LOAD-002999'))throw Error('Deep search missing');
for(const c of [1,5,10,20])await run(c,25,'steady');
await run(5,60,'sustained');
await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie},redirect:'manual'});
