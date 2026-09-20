// Checks actual generated plant roots against live water in every loaded reach.
export async function validateVegetation(page) {return page.evaluate(async()=>{
 let trees=0,grass=0,wetTrees=0,wetGrass=0,minHeight=Infinity,maxHeight=0;const species=new Set();
 for(const {solver:s} of river.sections.sections.values()) {
  const roots=await river.runtime.read(s.Trees),bank=await river.runtime.read(s.Bank),water=await river.runtime.read(s.Surface),{nx,nz,x0,dx,dz}=s.grid;
  const flooded=(x,y,z)=>{if(x<x0||x>x0+(nx-1)*dx)return false;const k=(Math.min(nz-1,Math.max(0,Math.floor(z/dz)))*nx+Math.min(nx-1,Math.max(0,Math.floor((x-x0)/dx))))*16;return water[k+7]>.02&&y<water[k+1]+.1};
  for(let i=0;i<roots.length/4;i++){const o=i*4,h=roots[o+3];if(h===0)continue;trees++;minHeight=Math.min(minHeight,h);maxHeight=Math.max(maxHeight,h);if(flooded(roots[o],roots[o+1],roots[o+2]))wetTrees++;}
  for(let i=0;i<2400;i++){const o=i*3*4*8,h=bank[o+9]-bank[o+1];if(h<=.01)continue;grass++;species.add(Math.floor(bank[o+7]*10));if(flooded(bank[o],bank[o+4],bank[o+2]))wetGrass++;}
 }
 const result={trees,grass,wetTrees,wetGrass,minHeight,maxHeight,grassVariants:species.size};
 if(trees<200||grass<1000||wetTrees||wetGrass||maxHeight/minHeight<3||species.size<8)throw Error('Vegetation placement/variance: '+JSON.stringify(result));return result;
});}
