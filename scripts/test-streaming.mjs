import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://localhost:5175/');await page.waitForFunction(()=>window.river?.ready,null,{timeout:180000});
 await page.waitForTimeout(2000);
 await page.evaluate(()=>{window.loadingLongTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())loadingLongTasks.push(e.duration)}).observe({type:'longtask'});river.frameStats.intervals.length=0;window.resourceCount=river.runtime.buffers.size;});
 await page.waitForTimeout(2000);
 const baseline=await page.evaluate(()=>river.frameStats.intervals.slice());
 await page.evaluate(()=>{river.navigation.position.z=120;river.frameStats.intervals.length=0;});
 await page.waitForFunction(()=>river.sections.sections.has(4)&&!river.sections.pending,null,{timeout:45000});
 const streaming=await page.evaluate(()=>({intervals:river.frameStats.intervals.slice(),longTasks:loadingLongTasks,stats:river.sections.stats,buffersBefore:resourceCount,buffersAfter:river.runtime.buffers.size,ready:river.ready}));
 const summarize=a=>{const s=[...a].sort((a,b)=>a-b);return {frames:s.length,fps:1000/(a.reduce((a,b)=>a+b,0)/a.length),p95:s[Math.floor(s.length*.95)],max:Math.max(...a)}};
 const result={baseline:summarize(baseline),streaming:{...streaming,intervals:summarize(streaming.intervals)},errors};
 await writeFile('reports/streaming-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(errors.length||!streaming.ready||streaming.buffersAfter!==streaming.buffersBefore||streaming.stats.completed<1)throw Error('Streaming regression');
 if(result.baseline.fps>61||result.streaming.intervals.fps>61)throw Error('60 FPS cap exceeded');
 await page.screenshot({path:'reports/streaming-performance.png'});
 const environment=await page.evaluate(async()=>{
  const sky=await river.runtime.read(river.solver.Sky,Uint32Array),canopy=await river.runtime.read(river.solver.Canopy,Uint32Array);
  const colors=new Set();for(let i=0;i<sky.length;i+=31)colors.add(sky[i]);
  let clear=0,solid=0;for(const pixel of canopy){if((pixel>>>24)<10)clear++;if((pixel>>>24)>180)solid++;}
  return {skyColors:colors.size,canopyClearPixels:clear,canopySolidPixels:solid};
 });
 if(environment.skyColors<100||environment.canopyClearPixels<100||environment.canopySolidPixels<100)throw Error('CUDA environment texture is empty');
 console.log(JSON.stringify({environment}));
 await page.evaluate(()=>{river.navigation.position.set(8,23,115);river.navigation.pitch=.20;});
 await page.waitForTimeout(200);await page.screenshot({path:'reports/v02-sky.png'});
 await page.evaluate(()=>{river.navigation.position.set(6,19,94);river.navigation.pitch=-.30;});
 await page.waitForTimeout(200);await page.screenshot({path:'reports/v02-overview.png'});
} finally {await browser.close();}
