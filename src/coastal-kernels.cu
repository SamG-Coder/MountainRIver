// River adaptation: velocity safety bound raised from 5 to 9 m/s.
// Coastal finite-volume solver, ported from simulation.js / solver-kernels.ts.
// Every pass has one invocation per cell. Separate dispatches provide grid-wide
// ordering; no workgroup barrier is used as a substitute for a grid barrier.
// S layout is documented and shared in cuda-solver.js. All values are f32.
__device__ float cap(float x, float a, float b) { return fmaxf(a,fminf(b,x)); }
__device__ float smooth(float a, float b, float x) {
 float t=cap((x-a)/(b-a),0.0f,1.0f); return t*t*(3.0f-2.0f*t);
}
__device__ float adv(const float *p,int k,int nx,float ax,float fx,float az,float fz) {
 return (p[k]*ax+p[k+1]*fx)*az+(p[k+nx]*ax+p[k+nx+1]*fx)*fz;
}

// Backtrace each staggered velocity from its own face location. The other
// component is interpolated from the four surrounding faces. A separate
// dispatch is essential: faces must never sample neighbours being overwritten.
__global__ void advectMomentum(const float *S,float *Aux,int nx,int nz,float dx,float dz,float dt){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;const float *u=S+3*n;const float *v=S+4*n;
 int l=max(i-1,0),r=min(i+1,nx-1),b=max(j-1,0),f=min(j+1,nz-1);
 float crossV=(v[k]+v[j*nx+r]+v[b*nx+i]+v[b*nx+r])*.25f;
 float crossU=(u[k]+u[f*nx+i]+u[j*nx+l]+u[f*nx+l])*.25f;
 float bx=cap((float)i-u[k]*dt/dx,0.0f,(float)nx-1.001f),bz=cap((float)j-crossV*dt/dz,0.0f,(float)nz-1.001f);
 int ix=(int)bx,iz=(int)bz;float fx=bx-(float)ix,fz=bz-(float)iz;
 Aux[k]=i<nx-1?adv(u,iz*nx+ix,nx,1.0f-fx,fx,1.0f-fz,fz):0.0f;
 bx=cap((float)i-crossU*dt/dx,0.0f,(float)nx-1.001f);bz=cap((float)j-v[k]*dt/dz,0.0f,(float)nz-1.001f);
 ix=(int)bx;iz=(int)bz;fx=bx-(float)ix;fz=bz-(float)iz;
 Aux[n+k]=j<nz-1?adv(v,iz*nx+ix,nx,1.0f-fx,fx,1.0f-fz,fz):0.0f;
}
__global__ void faces(float *S,const float *Aux,int nx,int nz,float dx,float dz,float dt,int enhanced) {
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;
 if(k>=n)return;
 int i=k%nx,j=k/nx;
 float *bed=S;float *h=S+2*n;float *u=S+3*n;float *v=S+4*n;float *fluxX=S+12*n;float *fluxZ=S+13*n;
 float eta=bed[k]+h[k];
 if(i<nx-1){
  int q=k+1;float e2=bed[q]+h[q],crest=fmaxf(bed[k],bed[q]),faceH=fmaxf(0.0f,fmaxf(eta,e2)-crest);
  if(faceH<.001f){u[k]=0;fluxX[k]=0;}else{
   float drag=.065f+.08f/(faceH+.075f)+(enhanced!=0?Aux[2*n+k]*.35f:0.0f);
   float velocity=enhanced!=0?Aux[k]:u[k];
   u[k]=cap((velocity-9.81f*dt*(e2-eta)/dx)/(1.0f+dt*drag),-9.0f,9.0f);
   float donor=u[k]>0?fmaxf(0.0f,eta-crest):fmaxf(0.0f,e2-crest);
   fluxX[k]=u[k]*donor;
   if(h[k]>.008f&&h[q]>.008f)fluxX[k]-=.32f*smooth(.12f,.48f,fabsf(e2-eta)/dx)*(e2-eta)/dx;
  }
 }else fluxX[k]=0;
 if(j<nz-1){
  int q=k+nx;float e2=bed[q]+h[q],crest=fmaxf(bed[k],bed[q]),faceH=fmaxf(0.0f,fmaxf(eta,e2)-crest);
  if(faceH<.001f){v[k]=0;fluxZ[k]=0;}else{
   float drag=.065f+.08f/(faceH+.075f)+(enhanced!=0?Aux[2*n+k]*.35f:0.0f);
   float velocity=enhanced!=0?Aux[n+k]:v[k];
   v[k]=cap((velocity-9.81f*dt*(e2-eta)/dz)/(1.0f+dt*drag),-9.0f,9.0f);
   float donor=v[k]>0?fmaxf(0.0f,eta-crest):fmaxf(0.0f,e2-crest);
   fluxZ[k]=v[k]*donor;
   if(h[k]>.008f&&h[q]>.008f)fluxZ[k]-=.32f*smooth(.12f,.48f,fabsf(e2-eta)/dz)*(e2-eta)/dz;
  }
 }else fluxZ[k]=0;
}
__global__ void limits(float *S,int nx,int nz,float dx,float dz,float dt){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;
 float *h=S+2*n;float *fluxX=S+12*n;float *fluxZ=S+13*n;float *limit=S+14*n;
 float outgoing=(fmaxf(fluxX[k],0.0f)+(i>0?fmaxf(-fluxX[k-1],0.0f):0.0f))/dx+(fmaxf(fluxZ[k],0.0f)+(j>0?fmaxf(-fluxZ[k-nx],0.0f):0.0f))/dz;
 limit[k]=outgoing>0?fminf(1.0f,h[k]/(dt*outgoing+1e-10f)):1.0f;
}
__global__ void limitFlux(float *S,int nx,int nz){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 float *fluxX=S+12*n;float *fluxZ=S+13*n;float *limit=S+14*n;
 fluxX[k]*=fluxX[k]>=0?limit[k]:limit[min(k+1,n-1)];
 fluxZ[k]*=fluxZ[k]>=0?limit[k]:limit[min(k+nx,n-1)];
}
__global__ void integrate(float *S,int nx,int nz,float dx,float dz,float dt){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;
 float *h=S+2*n;float *next=S+11*n;float *fluxX=S+12*n;float *fluxZ=S+13*n;
 next[k]=fmaxf(0.0f,h[k]-dt*((fluxX[k]-(i>0?fluxX[k-1]:0.0f))/dx+(fluxZ[k]-(j>0?fluxZ[k-nx]:0.0f))/dz));
}
// B contains sponge weights, separable wave X cos/sin, row cos/sin and group.
__global__ void boundary(float *S,const float *B,const float *Controls,int nx,int nz,float dt){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;
 float *bed=S;float *h=S+2*n;float *next=S+11*n;float *u=S+3*n;float *v=S+4*n;
 float blend=1.0f-expf(-dt*B[k]*9.0f),tide=Controls[2];
 if(blend>0){
  float wave=0;
  for(int w=0;w<4;w++)wave+=B[n+w*2*nx+i]*B[n+8*nx+w*2*nz+j]-B[n+w*2*nx+nx+i]*B[n+8*nx+w*2*nz+nz+j];
  float arrival=tide+wave*B[n+8*nx+8*nz+j],targetH=fmaxf(0.0f,arrival-bed[k]);
  next[k]+=(targetH-next[k])*blend;
  float waveU=-(arrival-tide)*sqrtf(9.81f/fmaxf(.45f,tide-bed[k]));
  u[k]+=(waveU-u[k])*blend;v[k]*=1.0f-blend*.5f;
 }
 if(next[k]<.0015f)next[k]*=expf(-dt*1.5f);
 h[k]=next[k];
}
__global__ void transport(float *S,float *Aux,const float *Controls,int nx,int nz,float dx,float dz,float x0,float z0,float dt,int enhanced){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;
 float *bed=S;float *sand=S+n;float *h=S+2*n;float *u=S+3*n;float *v=S+4*n;float *foam=S+5*n;float *old=S+6*n;float *wet=S+7*n;float *film=S+8*n;float *qx=S+9*n;float *qz=S+10*n;
 float *foamNext=S+15*n;float *oldNext=S+16*n;float *qxNext=S+17*n;float *qzNext=S+18*n;
 float restore=dt*.017f,strength=Controls[0];
 float freshDecay=expf(-dt*.65f),oldDecay=expf(-dt*.145f),wetDecay=expf(-dt*.011f),filmDecay=expf(-dt*.31f);
 float ux=(u[k]+(i>0?u[k-1]:u[k]))*.5f,vz=(v[k]+(j>0?v[k-nx]:v[k]))*.5f;
 float bx=cap((float)i-ux*dt/dx,0.0f,(float)nx-1.001f),bz=cap((float)j-vz*dt/dz,0.0f,(float)nz-1.001f);
 int ix=(int)bx,iz=(int)bz,k0=iz*nx+ix;
 float fx=bx-(float)ix,fz=bz-(float)iz,ax=1.0f-fx,az=1.0f-fz;
 float f=adv(foam,k0,nx,ax,fx,az,fz),o=adv(old,k0,nx,ax,fx,az,fz);
 float ex=i>0&&i<nx-1?fabsf(bed[k+1]+h[k+1]-bed[k-1]-h[k-1])/(2.0f*dx):0.0f;
 float ez=j>0&&j<nz-1?fabsf(bed[k+nx]+h[k+nx]-bed[k-nx]-h[k-nx])/(2.0f*dz):0.0f;
 float gradient=sqrtf(ex*ex+ez*ez),compression=-((u[k]-(i>0?u[k-1]:u[k]))/dx+(v[k]-(j>0?v[k-nx]:v[k]))/dz);
 float speed=sqrtf(ux*ux+vz*vz),depth=h[k];
 float front=smooth(.009f,.035f,depth)*(1.0f-smooth(.14f,.46f,depth));
 float bore=smooth(.11f,.28f,gradient)*smooth(.025f,.58f,compression)*smooth(.055f,.16f,depth)*(1.0f-smooth(1.2f,2.6f,depth));
 bool obstacle=bed[k]-sand[k]>.08f;
 float impact=obstacle?smooth(.65f,1.6f,speed)*smooth(.04f,.3f,depth)*(1.0f-smooth(.3f,.9f,depth))*smooth(.12f,1.0f,compression):0.0f;
 float advancingEdge=front*smooth(.15f,.95f,-ux)*(obstacle?.08f:1.0f);
 float source=(bore*(obstacle?.65f:2.65f)+advancingEdge*.90f+impact*.9f)*strength;
 if(enhanced!=0){
  // A bounded visual turbulence reservoir, carried by the water and dissipated
  // over seconds. Compression/steepness inject it; smooth uniform flow does not.
  float energy=adv(Aux+2*n,k0,nx,ax,fx,az,fz);
  float generated=bore*2.4f+impact*1.8f;
  energy=depth>.006f?cap(energy*expf(-dt*.85f)+dt*generated,0.0f,1.0f):0.0f;
  Aux[3*n+k]=energy;
  source+=energy*1.7f;
  freshDecay=expf(-dt*(.48f+.32f*(1.0f-energy)));
 }
 if(depth>.002f){
  foamNext[k]=cap(f*freshDecay+dt*source,0.0f,1.0f);oldNext[k]=cap(o*oldDecay+f*dt*.35f,0.0f,.85f);
  wet[k]=fminf(1.0f,wet[k]+dt*2.5f);film[k]=fmaxf(film[k],fminf(1.0f,depth*5.0f));
 }else{foamNext[k]=0;oldNext[k]=0;wet[k]*=wetDecay;film[k]*=filmDecay;}
 qxNext[k]=adv(qx,k0,nx,ax,fx,az,fz)*(1.0f-restore)+(x0+(float)i*dx)*restore;
 qzNext[k]=adv(qz,k0,nx,ax,fx,az,fz)*(1.0f-restore)+(z0+(float)j*dz)*restore;
}
__global__ void commitTransport(float *S,float *Aux,int nx,int nz,int enhanced){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 S[5*n+k]=S[15*n+k];S[6*n+k]=S[16*n+k];S[9*n+k]=S[17*n+k];S[10*n+k]=S[18*n+k];
 if(enhanced!=0)Aux[2*n+k]=Aux[3*n+k];
}

