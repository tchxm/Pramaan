// Capture existing, observed product results. No model run or product edits.
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const work=path.resolve('packages/web/qa/submission-audit/film');await mkdir(work,{recursive:true});
const browser=await chromium.launch({headless:true});
const shots={};
async function shot(name,setup,action,ms=4000) {
 const ctx=await browser.newContext({viewport:{width:1440,height:810},recordVideo:{dir:work,size:{width:1440,height:810}}});
 await ctx.addInitScript(()=>sessionStorage.setItem('pramaan:boot-shown','1'));
 const p=await ctx.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await setup(p);await p.waitForTimeout(500);
 const start=Date.now();if(action)await action(p);await p.waitForTimeout(ms);
 await p.screenshot({path:path.join(work,name+'.png')});
 shots[name]={errors,heldForMs:Date.now()-start};const v=p.video();await ctx.close();await v.saveAs(path.join(work,name+'.webm'));console.log('captured',name);
}
const live='http://127.0.0.1:5173/audit/PRM-2026-000115';
await shot('problem',async p=>{await p.goto('http://127.0.0.1:5173/demo');await p.locator('.demo-cart').scrollIntoViewIfNeeded();},async p=>{await p.locator('.demo-cart').hover();});
await shot('hero',async p=>{await p.goto('http://127.0.0.1:5173/');},async p=>{await p.mouse.move(1000,450);},3000);
await shot('findings',async p=>{await p.goto('http://127.0.0.1:5173/demo?step=2');await p.locator('.demo-findings').scrollIntoViewIfNeeded();},null);
await shot('source',async p=>{await p.goto(live);await p.getByTestId('finding-row-F-PRM-001-1').click();await p.getByRole('tab',{name:'Code',exact:true}).click();},null);
await shot('tools',async p=>{await p.goto(live);await p.getByTestId('finding-row-F-PRM-001-1').click();},async p=>{
 for(const seq of [4,8,11,14]) {const row=p.getByTestId('trace-event-'+seq);if(await row.count()){await row.scrollIntoViewIfNeeded();await row.click();await p.waitForTimeout(1800);}}
},1500);
await shot('diff',async p=>{await p.goto(live);await p.getByTestId('finding-row-F-PRM-001-1').click();await p.getByRole('tab',{name:'Diff',exact:true}).click();},null);
await shot('before',async p=>{await p.goto('http://127.0.0.1:5191/cart');await p.locator('input[type=checkbox]').waitFor();},async p=>{if(!await p.locator('input[type=checkbox]').isChecked())throw Error('original default not checked');},2500);
await shot('after',async p=>{await p.goto('http://127.0.0.1:5192/cart');await p.locator('input[type=checkbox]').waitFor();},async p=>{
 const c=p.locator('input[type=checkbox]');if(await c.isChecked())throw Error('patched default not clear');await p.waitForTimeout(1600);await c.check();await p.waitForTimeout(1200);await c.uncheck();
},2000);
await shot('gates',async p=>{await p.goto(live+'/outcome');await p.getByTestId('outcome-after').filter({hasText:/^0$/}).waitFor();},async p=>{await p.getByText('What do the five independent checks prove?',{exact:true}).click();},5000);
await shot('proof',async p=>{await p.goto('http://127.0.0.1:5173/verify');await p.locator('input[type=file]').setInputFiles([path.resolve('packages/web/qa/submission-audit/live-footage/evidence-pack.json'),path.resolve('packages/web/qa/submission-audit/live-footage/trace.jsonl')]);},async p=>{await p.getByRole('button',{name:'Verify pack',exact:true}).click();await p.locator('.ws-pack-verifier__checks').waitFor();},5000);
await writeFile(path.join(work,'captures.json'),JSON.stringify(shots,null,2));await browser.close();
