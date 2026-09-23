/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner supports external Playwright. */
const {readFileSync}=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=(process.env.MIGRA_BASE_URL || 'http://localhost:3000').replace(/\/$/,'');
const credentialText=process.env.MIGRA_TEST_CREDENTIAL_FILE?readFileSync(process.env.MIGRA_TEST_CREDENTIAL_FILE,'utf8'):'';
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/api/auth/login');
const username=process.env.MIGRA_TEST_USERNAME||credentialText.match(/^账号：(.+)$/m)?.[1],password=process.env.MIGRA_TEST_PASSWORD||credentialText.match(/^密码：(.+)$/m)?.[1];if(!username||!password)throw Error('Set isolated browser-test credentials');
await page.locator('#username').fill(username);await page.locator('#password').fill(password);await page.getByRole('button',{name:'进入系统'}).click();await page.waitForURL(base+'/');
await page.goto(base+'/settings/system');await page.getByText('当前进程',{exact:false}).waitFor();
await page.clock.install();
await page.clock.pauseAt(new Date(Date.now()+1000));
let calls=0, mode='pending';
const rows=Array.from({length:12},(_,i)=>({order_no:'SYNC-'+i,agent_name:'同步测试',project_name:'测试项目',main_applicant:null}));
await page.route('**/api/data/search?*',async route=>{
 calls++;
 if(mode==='error')return route.fulfill({status:500,json:{error:'mock failure'}});
 await route.fulfill({json:{indexing:mode==='pending',orders:mode==='done'?[rows[11],...rows.slice(0,11)]:rows,projects:[],agents:[]}});
});
await page.keyboard.press('ControlOrMeta+k');
const input=page.getByPlaceholder('例如：zhangsan+USD+15000 或 张三+护照');
await input.fill('synctest');
async function advance(ms){await page.clock.runFor(ms);await page.waitForTimeout(150);}
await advance(350);if(calls!==1)throw Error('Initial request '+calls);
await advance(900);if(calls!==1)throw Error('Polled before 1s');await advance(150);if(calls!==2)throw Error('1s poll missing');
await advance(2000);if(calls!==3)throw Error('2s poll missing');
await advance(4000);if(calls!==4)throw Error('4s poll missing');
await page.locator('[cmdk-item]').nth(5).hover();
await advance(100);
const selected=await page.locator('[cmdk-item][data-selected="true"]').getAttribute('data-value');
await page.locator('[cmdk-list]').evaluate(el=>el.scrollTop=160);const top=await page.locator('[cmdk-list]').evaluate(el=>el.scrollTop);
mode='done';await advance(8000);await advance(100);
if(await input.inputValue()!=='synctest')throw Error('Input overwritten');
if(await page.locator('[cmdk-item][data-selected="true"]').getAttribute('data-value')!==selected)throw Error('Selection lost');
if(Math.abs(await page.locator('[cmdk-list]').evaluate(el=>el.scrollTop)-top)>2)throw Error('Scroll lost: expected '+top+' got '+await page.locator('[cmdk-list]').evaluate(el=>el.scrollTop));
let before=calls;await advance(16000);if(calls!==before)throw Error('Poll after completed');console.log('PASS 1/2/4/8s backoff, completion, input, selection and scroll');
mode='pending';await input.fill('deadline');await advance(350);
for(let i=0;i<9;i++)await advance(8000);
await page.getByText('自动刷新已暂停',{exact:false}).waitFor();before=calls;await advance(16000);if(calls!==before)throw Error('Poll after deadline');console.log('PASS 60 second limit');
await input.fill('visibility');await advance(350);before=calls;
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await advance(10000);if(calls!==before)throw Error('Hidden polling');
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await advance(350);if(calls!==before+1)throw Error('No resume');
mode='error';await advance(2000);await page.getByText('搜索更新失败',{exact:false}).waitFor();if(await page.locator('[cmdk-item]').count()!==12)throw Error('Results cleared');console.log('PASS hidden pause/resume and failure preserves results');
mode='pending';await input.fill('   ');await advance(350);before=calls;await advance(16000);if(calls!==before)throw Error('Blank query polling');
await page.keyboard.press('Escape');before=calls;await advance(16000);if(calls!==before)throw Error('Closed polling');
if(errors.length)throw Error(errors.join('\n'));console.log('PASS blank query and close stop polling; no page errors');
await page.keyboard.press('ControlOrMeta+k');
let aborted=0;
page.on('requestfailed',request=>{if(request.url().includes('q=slow'))aborted++;});
await page.route('**/api/data/search?q=slow*',async route=>{await new Promise(r=>setTimeout(r,1000));await route.fulfill({json:{indexing:false,orders:[{...rows[0],order_no:'STALE-RESULT'}],projects:[],agents:[]}}).catch(()=>{});});
await input.fill('slowchange');await advance(350);await input.fill('fresh');mode='done';await advance(350);await page.waitForTimeout(1200);
if(aborted<1)throw Error('Old query request not aborted');if(await page.getByText('STALE-RESULT',{exact:true}).count())throw Error('Stale response applied');
await input.fill('slowhide');await advance(350);const abortedBefore=aborted;
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(1200);
if(aborted<=abortedBefore)throw Error('Hidden inflight request not aborted');
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
await page.keyboard.press('Escape');console.log('PASS inflight requests cancelled on query change and hide; stale result ignored');
await page.request.post(base+'/api/auth/logout',{headers:{origin:base}});
}finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
