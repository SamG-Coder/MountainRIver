export async function validateCoupling(page) {return page.evaluate(async()=>{
 const rt=river.runtime,kernels=river.solver.kernels,nx=9,nz=7,n=nx*nz;
 const a=new Float32Array(n*19),b=new Float32Array(n*19);
 for(let k=0;k<n;k++){a[k]=-8;a[2*n+k]=1.8;a[3*n+k]=.5;a[4*n+k]=4;a[5*n+k]=.9;b[k]=0;b[2*n+k]=1;b[4*n+k]=1;}
 const A=rt.createBuffer(a),B=rt.createBuffer(b),EA=rt.createBuffer(nx*2*4*4),EB=rt.createBuffer(nx*2*4*4);
 const batch=rt.batch(),groups=[Math.ceil(nx*2/128),1,1];
 for(const [S,Edges] of [[A,EA],[B,EB]])batch.dispatch(kernels.captureEdges.bind({S,Edges},{nx,nz}),groups);
 batch.dispatch(kernels.connectEdges.bind({S:A,Edges:EA,UpEdges:EA,DownEdges:EB},{nx,nz,hasUp:0,hasDown:1}),groups);
 batch.dispatch(kernels.connectEdges.bind({S:B,Edges:EB,UpEdges:EA,DownEdges:EB},{nx,nz,hasUp:1,hasDown:0}),groups);batch.submit();
 const aa=await rt.read(A),bb=await rt.read(B),q=(nz-1)*nx+4,p=4;
 const result={upperDepth:aa[2*n+q],lowerDepth:bb[2*n+p],upperVelocity:aa[4*n+q],lowerVelocity:bb[4*n+p],upperFoam:aa[5*n+q],lowerFoam:bb[5*n+p]};
 for(const x of [A,B,EA,EB])rt.destroyBuffer(x);
 if(Math.abs(result.upperDepth-1.4)>1e-5||Math.abs(result.lowerDepth-1.4)>1e-5||result.upperVelocity!==2.5||result.lowerVelocity!==2.5||Math.abs(result.lowerFoam-.9)>1e-5)throw Error('Cross-section transfer failed: '+JSON.stringify(result));
 return result;
});}
