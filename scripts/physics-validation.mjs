// Numerical tests execute the actual CUDA kernels on the browser's GPU.
export async function validatePhysics(page){return page.evaluate(async()=>{
 const app=window.river,r=app.runtime,solver=app.solver;
 async function closedDomain(pulse){
  const nx=33,nz=35,n=nx*nz,data=new Float32Array(n*19);
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=j*nx+i;data[2*n+k]=1+(pulse?.35*Math.exp(-((i-16)**2+(j-17)**2)/16):0);data[9*n+k]=i*.4;data[10*n+k]=j*.4;}
  const S=r.createBuffer(data),Aux=r.createBuffer(n*4*4),Controls=r.createBuffer(new Float32Array([1,0,0])),resources={S,Aux,Controls,World:solver.World};
  const sum=a=>{let v=0;for(let i=0;i<n;i++)v+=a[2*n+i];return v;},initial=sum(data),bindings={};
  const entries=['advectMomentum','faces','limits','limitFlux','integrate','riverBoundary'];
  for(const entry of entries){const k=solver.kernels[entry],values={nx,nz,x0:0,dx:.4,dz:.4,dt:1/120,enhanced:1,time:0,flow:1,closed:1,hasUp:0,hasDown:0};bindings[entry]=k.bind(Object.fromEntries(k.artifact.metadata.bindings.map(x=>[x.name,resources[x.name]])),Object.fromEntries(k.artifact.metadata.scalars.map(x=>[x.name,values[x.name]])));}
  for(let block=0;block<8;block++){const b=r.batch();for(let step=0;step<30;step++)for(const entry of entries)b.dispatch(bindings[entry],[Math.ceil(n/128),1,1]);b.submit();await r.idle();}
  const actual=await r.read(S);let maxChange=0,minDepth=Infinity,maxVelocity=0;for(let i=0;i<n;i++){maxChange=Math.max(maxChange,Math.abs(actual[2*n+i]-data[2*n+i]));minDepth=Math.min(minDepth,actual[2*n+i]);maxVelocity=Math.max(maxVelocity,Math.abs(actual[3*n+i]),Math.abs(actual[4*n+i]));}
  const result={finite:actual.every(Number.isFinite),relativeVolumeError:Math.abs(sum(actual)-initial)/initial,maxChange,minDepth,maxVelocity};for(const x of [S,Aux,Controls])r.destroyBuffer(x);return result;
 }
 const lake=await closedDomain(false),pulse=await closedDomain(true);
 if(!lake.finite||lake.maxChange>1e-6||lake.maxVelocity>1e-6)throw Error('Lake-at-rest equilibrium failed');
 if(!pulse.finite||pulse.minDepth<0||pulse.relativeVolumeError>1e-5||pulse.maxChange<.01||pulse.maxVelocity<.01)throw Error('Closed-domain wave propagation or conservation failed');
 const before=await r.read(solver.S),uploads=r.stats.dataBytesUploaded,n=solver.n;
 // Thirty simulated seconds, including both extremes of the flow control.
 for(let block=0;block<120;block++){solver.flow=block<60?.4:2;const b=r.batch();for(let step=0;step<30;step++)solver.step(b);b.submit();await r.idle();}
 const batch=r.batch();solver.publish(batch);batch.submit();const after=await r.read(solver.S);
 let maxDepth=0,minDepth=Infinity,change=0,foam=0,transverse=0,wetRockCells=0;
 for(let k=0;k<n;k++){const h=after[2*n+k];maxDepth=Math.max(maxDepth,h);minDepth=Math.min(minDepth,h);change=Math.max(change,Math.abs(h-before[2*n+k]));foam+=after[5*n+k];if(h>.02){transverse=Math.max(transverse,Math.abs(after[3*n+k]));if(after[k]-after[n+k]>.08)wetRockCells++;}}
 const river={finite:after.every(Number.isFinite),maxDepth,minDepth,maxDepthChange:change,foamSum:foam,maxTransverseVelocity:transverse,wetRockCells,seconds:solver.time,perFrameUploadBytes:r.stats.dataBytesUploaded-uploads};
 if(!river.finite||minDepth<0||maxDepth>12||change<.01||foam<=0||transverse<.01||wetRockCells===0||river.perFrameUploadBytes!==0)throw Error('River stability/rock coupling/GPU residency failed: '+JSON.stringify(river));
 solver.flow=1;return {lake,pulse,river};
});}
