export async function validateSections(page) {
 await page.waitForFunction(()=>[0,-1,1,-2,2,-3,3].every(id=>river.sections.sections.has(id))&&!river.sections.pending,null,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const r=river.runtime,a=river.sections.sections.get(0).solver,b=river.sections.sections.get(1).solver;
  const ta=await r.read(a.Terrain),tb=await r.read(b.Terrain),wa=await r.read(a.Surface),wb=await r.read(b.Surface);
  let terrainError=0,waterError=0;
  for(let i=0;i<341;i++)terrainError=Math.max(terrainError,Math.abs(ta[(220*341+i)*8+1]-tb[i*8+1]+8));
  for(let i=0;i<a.grid.nx;i++)if(wa[((a.grid.nz-1)*a.grid.nx+i)*16+7]>.05&&wb[i*16+7]>.05)waterError=Math.max(waterError,Math.abs(wa[((a.grid.nz-1)*a.grid.nx+i)*16+1]-wb[i*16+1]+8));
  const reference=await r.read(a.R),other=await r.read(b.R),output=r.createBuffer(105*8*4);
  const kernel=a.kernels.initializeRocks,binding=kernel.bind({World:a.World,R:output},{count:105});const batch=r.batch();batch.dispatch(binding,[1,1,1]);batch.submit();const repeat=await r.read(output);r.destroyBuffer(output);
  const deterministic=reference.every((v,i)=>v===repeat[i]),different=reference.some((v,i)=>v!==other[i]);
  window.crossingState={buffer:a.S.id,wet:a.RockWet.id};
  if(terrainError>1e-4||waterError>1e-4||!deterministic||!different)throw Error(JSON.stringify({terrainError,waterError,deterministic,different}));
  return {terrainError,waterError,deterministic,different};
 });
 await page.evaluate(()=>{river.navigation.position.set(5,3,109.99);});await page.waitForTimeout(100);
 const before=await page.evaluate(()=>river.camera.position.toArray());
 await page.evaluate(()=>{river.navigation.position.z=110.01;});await page.waitForTimeout(100);
 const after=await page.evaluate(()=>({position:river.camera.position.toArray(),preserved:river.sections.sections.get(0).solver.S.id===crossingState.buffer&&river.sections.sections.get(0).solver.RockWet.id===crossingState.wet}));
 if(Math.abs(after.position[2]-before[2]-.02)>1e-6||after.position[1]!==before[1]||!after.preserved)throw Error('Section crossing rebased camera or replaced simulation buffers');
 await page.evaluate(()=>river.navigation.setView(0));
 return {...result,cameraDelta:after.position[2]-before[2],wetnessBuffersPreserved:after.preserved};
}
