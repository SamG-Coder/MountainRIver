// River geometry, obstacles, boundary conditions and GPU render publication.
// Compiled together with the original coastal finite-volume kernels.
// World = [worldSeed, signed sectionId]. Four subsections share a watershed
// group. Boundary properties are functions of absolute boundary IDs, never load
// order.
__device__ float worldHash(int seed) {
  unsigned int h = (unsigned int)seed + 374761393u;
  h = (h ^ (h >> 16)) * 2246822519u;
  h = (h ^ (h >> 13)) * 3266489917u;
  h = h ^ (h >> 16);
  return (float)(h & 16777215u) / 16777216.0f;
}
__device__ float randomRiver(const float *World, int seed) {
  return worldHash(seed + (int)World[0] * 397 + (int)World[1] * 7919);
}
__device__ float boundaryRandom(const float *World, int id, int salt) {
  return worldHash((int)World[0] * 397 + id * 7919 + salt * 1013);
}
__device__ float riverCenter(const float *World, float z) {
  float p = World[1] + z / 110.0f;
  int b = (int)floorf(p);
  float t = p - (float)b, f = t * t * (3.0f - 2.0f * t);
  return (boundaryRandom(World, b, 1) * 2.0f - 1.0f) * 23.0f * (1.0f - f) +
         (boundaryRandom(World, b + 1, 1) * 2.0f - 1.0f) * 23.0f * f;
}
__device__ float riverWidth(const float *World, float z) {
  float p = World[1] + z / 110.0f;
  int b = (int)floorf(p);
  float t = p - (float)b, f = t * t * (3.0f - 2.0f * t);
  float a = boundaryRandom(World, b, 2), c = boundaryRandom(World, b + 1, 2);
  float wa = 5.5f + powf(a, 2.2f) * 15.5f, wc = 5.5f + powf(c, 2.2f) * 15.5f;
  return wa * (1.0f - f) + wc * f;
}
__device__ float forkAmount(const float *World, float z) {
  float p = World[1] + z / 110.0f;
  int group = (int)floorf(p / 4.0f);
  float t = p - (float)group * 4.0f;
  float enabled = boundaryRandom(World, group, 71) > .32f ? 1.0f : 0.0f;
  return enabled * smooth(.35f, 1.15f, t) * (1.0f - smooth(2.85f, 3.65f, t));
}
__device__ float forkSide(const float *World, float z) {
  int group = (int)floorf((World[1] + z / 110.0f) / 4.0f);
  return boundaryRandom(World, group, 73) > .5f ? 1.0f : -1.0f;
}
__device__ float branchCenter(const float *World, float z) {
  int group = (int)floorf((World[1] + z / 110.0f) / 4.0f);
  return riverCenter(World, z) +
         forkSide(World, z) * forkAmount(World, z) *
             (19.0f + boundaryRandom(World, group, 75) * 7.0f);
}
__device__ float channelDistance(const float *World, float x, float z) {
  float fork = forkAmount(World, z),
        d = fabsf(x - riverCenter(World, z)) - riverWidth(World, z);
  float branch =
      fabsf(x - branchCenter(World, z)) - (5.0f + riverWidth(World, z) * .18f);
  return fork > .015f
             ? fminf(d, branch + (1.0f - smooth(.015f, .3f, fork)) * 20.0f)
             : d;
}
// Section styles: 30% long shallow rapids, 22% concentrated plunge, remainder
// cascades.
__device__ float reachStyle(const float *World) {
  return randomRiver(World, 982);
}
__device__ float ledgeStart(const float *World, int tier, float x) {
  float gentle = reachStyle(World) < .30f ? 1.0f : 0.0f;
  float base = gentle > 0.0f ? (15.0f + (float)tier * 30.0f)
                             : (25.0f + (float)tier * 28.0f);
  return base + randomRiver(World, 901 + tier) * (gentle > 0.0f ? 3.0f : 8.0f) +
         2.0f * sinf(x * .19f + randomRiver(World, 941 + tier) * 6.28f);
}
__device__ float ledgeWidth(const float *World, int tier, float x) {
  float style = reachStyle(World);
  return style < .30f   ? 19.0f + randomRiver(World, 951 + tier) * 5.0f
         : style > .78f ? 1.8f + randomRiver(World, 951 + tier) * 1.5f
                        : 4.0f + randomRiver(World, 951 + tier) * 5.0f;
}
__device__ float ledgeHeight(const float *World, int tier) {
  if (reachStyle(World) > .78f) {
    int major = (int)(randomRiver(World, 983) * 3.0f);
    return tier == major ? 6.2f : .4f;
  }
  float a = .3f + randomRiver(World, 961), b = .3f + randomRiver(World, 962),
        c = .3f + randomRiver(World, 963);
  return 7.0f * (tier == 0 ? a : tier == 1 ? b : c) / (a + b + c);
}
__device__ float channelDepth(const float *World, float z) {
  float p = World[1] + z / 110.0f;
  int b = (int)floorf(p);
  float t = p - (float)b, f = t * t * (3.0f - 2.0f * t);
  return .38f + 1.25f * (boundaryRandom(World, b, 84) * (1.0f - f) +
                         boundaryRandom(World, b + 1, 84) * f);
}
__device__ float riverDatum(const float *World, float x, float z) {
  float y = -z / 110.0f;
  for (int tier = 0; tier < 3; tier++) {
    float start = ledgeStart(World, tier, x);
    y -= ledgeHeight(World, tier) *
         smooth(start, start + ledgeWidth(World, tier, x), z);
  }
  return y;
}
__device__ float riverLevel(const float *World, float z) {
  return riverDatum(World, 0.0f, z);
}
__device__ float terrainNoise(const float *World, float x, float z) {
  float p = World[1] + z / 110.0f;
  int b = (int)floorf(p);
  float t = p - (float)b, f = t * t * (3.0f - 2.0f * t);
  float phase = boundaryRandom(World, b, 32) * (1.0f - f) +
                boundaryRandom(World, b + 1, 32) * f;
  return sinf(x * .12f + phase * 6.28f) * 2.0f +
         sinf(x * .32f - phase * 9.0f) * .7f +
         sinf(x * .6f + phase * 23.0f) * .23f;
}
__device__ float riverGround(const float *World, float x, float z) {
  float d = fmaxf(0.0f, channelDistance(World, x, z) + .9f);
  return riverDatum(World, x, z) - channelDepth(World, z) +
         powf(d, 1.10f) * .70f +
         terrainNoise(World, x, z) * fminf(1.0f, d * .22f);
}
// Same immutable rock descriptors feed both the solver and the visible
// geometry.
__global__ void initializeRocks(const float *World, float *R, int count) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= count)
    return;
  float z = 8.0f + randomRiver(World, k * 9 + 2) * 94.0f;
  float side = randomRiver(World, k * 9 + 3) < .5f ? -1.0f : 1.0f;
  float x =
      riverCenter(World, z) +
      side * (riverWidth(World, z) + randomRiver(World, k * 9 + 4) * 15.0f);
  if (k % 3 == 0 && forkAmount(World, z) > .4f)
    x += branchCenter(World, z) - riverCenter(World, z);
  float s = 1.2f + randomRiver(World, k * 9 + 5) * 2.8f;
  if (k < 20) {
    x = (k % 3 == 0 && forkAmount(World, z) > .4f ? branchCenter(World, z)
                                                  : riverCenter(World, z)) +
        (randomRiver(World, k * 9 + 4) - .5f) * 13.0f;
    s = .7f + randomRiver(World, k * 9 + 5) * 1.1f;
  }
  R[k * 8] = x;
  R[k * 8 + 1] = z;
  R[k * 8 + 2] = s * (.7f + randomRiver(World, k * 13 + 91) * .9f);
  R[k * 8 + 3] = s * (.8f + randomRiver(World, k * 9 + 6) * .6f);
  R[k * 8 + 4] =
      s *
      (k < 20 ? (k % 5 == 0 ? 1.9f : .45f + randomRiver(World, k * 9 + 7) * .5f)
              : .4f + randomRiver(World, k * 9 + 7) * 1.1f);
  R[k * 8 + 5] = riverGround(World, x, z) - .1f;
  R[k * 8 + 6] =
      floorf(randomRiver(World, k * 31 + 941 + (int)floorf(x * 17.0f) +
                                    (int)floorf(z * 23.0f)) *
             8191.0f);
  R[k * 8 + 7] = randomRiver(World, k * 19 + 883) * 6.2831853f;
}
__device__ int rockType(const float *World, const float *R, int k) {
  float distance = fabsf(R[k * 8] - riverCenter(World, R[k * 8 + 1])) -
                   riverWidth(World, R[k * 8 + 1]);
  return distance < 0.0f   ? (k % 3 == 0 ? 0 : 1)
         : distance < 6.0f ? ((int)R[k * 8 + 6] % 3)
                           : 2 + (int)R[k * 8 + 6] % 2;
}
__device__ float rockExponent(const float *World, const float *R, int k) {
  int type = rockType(World, R, k);
  return type == 0 ? 2.1f : type == 1 ? 3.3f : type == 2 ? 4.0f : 2.7f;
}
__device__ float rockEdge(const float *World, const float *R, int k,
                          float theta) {
  float seed = R[k * 8 + 6];
  return 1.0f + .09f * sinf(theta * 3.0f + seed) +
         .045f * cosf(theta * 5.0f - seed * .71f);
}
__device__ float riverRock(const float *World, const float *R, int k, float x,
                           float z) {
  int a = k * 8, type = rockType(World, R, k);
  float angle = R[a + 7], c = cosf(angle), s = sinf(angle), xx = x - R[a],
        zz = z - R[a + 1];
  float u = (c * xx + s * zz) / R[a + 2], v = (-s * xx + c * zz) / R[a + 3],
        seed = R[a + 6], edge = rockEdge(World, R, k, atan2f(v, u)),
        power = rockExponent(World, R, k);
  float q = powf(fabsf(u / edge), power) + powf(fabsf(v / edge), power);
  if (q >= 1.0f)
    return riverGround(World, x, z);
  float top = powf(1.0f - q, type == 0 ? .6f : type == 1 ? .32f : .24f);
  float skew = randomRiver(World, (int)seed + 8) - .5f;
  top = fminf(top,
              (type == 1 ? .58f : .93f) + u * (.15f + skew * .55f) - v * .23f);
  top = fminf(top,
              1.03f - u * (type == 3 ? .62f : .19f) + v * (.2f + skew * .5f));
  top = fminf(top, 1.06f + u * .31f + v * .54f);
  float fracture =
      .055f * expf(-fabsf(u + v * (.25f + skew) - skew * .5f) * 48.0f);
  float relief = .025f * sinf(u * 12.0f + v * 7.0f + seed) *
                 sinf(v * 17.0f - u * 5.0f + seed);
  float ground = riverGround(World, x, z),
        rock = R[a + 5] + R[a + 4] * (top + relief * top - fracture);
  return ground + fmaxf(0.0f, rock - ground) * smooth(1.0f, .87f, q);
}
__device__ float riverBed(const float *World, const float *R, float x,
                          float z) {
  float y = riverGround(World, x, z);
  for (int r = 0; r < 105; r++) {
    int a = r * 8;
    if (fabsf(x - R[a]) < fmaxf(R[a + 2], R[a + 3]) * 1.4f &&
        fabsf(z - R[a + 1]) < fmaxf(R[a + 2], R[a + 3]) * 1.4f)
      y = fmaxf(y, riverRock(World, R, r, x, z));
  }
  return y;
}
__global__ void initializeRiver(const float *World, float *S, const float *R,
                                int nx, int nz, float x0, float z0, float dx,
                                float dz, int start) {
  int k = start + blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  float x = x0 + (float)(k % nx) * dx, z = z0 + (float)(k / nx) * dz;
  float bed = riverBed(World, R, x, z);
  S[k] = bed;
  S[n + k] = riverGround(World, x, z);
  S[2 * n + k] = fmaxf(0.0f, riverDatum(World, x, z) - bed);
  float branch =
      forkAmount(World, z) > .25f && fabsf(x - branchCenter(World, z)) <
                                         fabsf(x - riverCenter(World, z))
          ? 1.0f
          : 0.0f;
  float tangent =
      branch > 0.0f
          ? (branchCenter(World, z + .25f) - branchCenter(World, z - .25f)) /
                .5f
          : (riverCenter(World, z + .25f) - riverCenter(World, z - .25f)) / .5f;
  S[4 * n + k] =
      S[2 * n + k] > .01f ? 3.2f / sqrtf(1.0f + tangent * tangent) : 0.0f;
  S[3 * n + k] = S[4 * n + k] * tangent;
  S[9 * n + k] = x;
  S[10 * n + k] = z;
}
// Reservoir-fed upstream reach and absorbing downstream reach. These boundaries
// intentionally exchange volume; the interior transport is conservative.
__global__ void riverBoundary(const float *World, float *S, float *Controls,
                              int nx, int nz, float x0, float dx, float dz,
                              float dt, float time, float flow, int closed,
                              int hasUp, int hasDown) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  int j = k / nx;
  float depth = S[11 * n + k];
  if (closed == 0) {
    float z = (float)j * dz;
    float inlet = (hasUp == 0 ? 1.0f : 0.0f) * (1.0f - smooth(0.0f, 3.0f, z)),
          outlet = (hasDown == 0 ? 1.0f : 0.0f) * smooth(106.0f, 110.0f, z);
    float blend = 1.0f - expf(-dt * 12.0f * fmaxf(inlet, outlet));
    float surge = 0.0f;
    float target = fmaxf(0.0f, riverDatum(World, x0 + (float)(k % nx) * dx, z) +
                                   surge - S[k]);
    depth += (target - depth) * blend;
    S[4 * n + k] += (3.2f * flow - S[4 * n + k]) * blend;
    S[3 * n + k] *= 1.0f - blend * .5f;
  }
  S[2 * n + k] = fmaxf(0.0f, depth);
  if (k == 0)
    Controls[0] = flow;
}
__global__ void riverFoam(const float *World, float *S, float *Aux, int nx,
                          int nz, float dz, float dt) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  int j = k / nx;
  float h = S[2 * n + k];
  float slope = j > 0 && j < nz - 1 ? fabsf(S[k + nx] + S[2 * n + k + nx] -
                                            S[k - nx] - S[2 * n + k - nx]) /
                                          (2.0f * dz)
                                    : 0.0f;
  float speed = fabsf(S[4 * n + k]);
  float source = smooth(.12f, .7f, slope) * smooth(1.0f, 3.5f, speed) *
                 smooth(.02f, .3f, h);
  float x = -64.0f + (float)(k % nx) * 128.0f / (float)(nx - 1),
        z = (float)j * dz;
  for (int tier = 0; tier < 3; tier++) {
    float landing =
        ledgeStart(World, tier, x) + ledgeWidth(World, tier, x) + .9f;
    float d = (z - landing) / 2.0f;
    source +=
        expf(-d * d) * smooth(.3f, 2.5f, speed) * smooth(.02f, .25f, h) * 1.7f;
  }
  S[5 * n + k] =
      cap(S[5 * n + k] * expf(-dt * .8f) + dt * source * 3.3f, 0.0f, 1.0f);
  S[6 * n + k] *= expf(-dt * 1.0f);
  Aux[2 * n + k] = cap(Aux[2 * n + k] + dt * source, 0.0f, 1.0f);
}
// Extrapolate surface through solid rock interiors; raster depth resolves
// rocks.
__global__ void reconstructRiver(const float *World, const float *S, float *Eta,
                                 int nx, int nz, float dz, float time,
                                 float flow) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  int i = k % nx, j = k / nx;
  float x = -64.0f + (float)i * 128.0f / (float)(nx - 1);
  float localDatum = riverDatum(World, x, (float)j * dz);
  float e = S[k] + S[2 * n + k];
  // Dry vertices must continue the water sheet UNDER the obstacle, not climb
  // its bed. Transfer only the free-surface anomaly, never an upstream pool's
  // absolute height across a waterfall.
  if (S[2 * n + k] < .06f) {
    float total = 0.0f, weight = 0.0f;
    for (int r = 1; r <= 12; r++) {
      for (int d = 0; d < 4; d++) {
        int ni = d == 0 ? max(0, i - r) : d == 1 ? min(nx - 1, i + r) : i;
        int nj = d == 2 ? max(0, j - r) : d == 3 ? min(nz - 1, j + r) : j;
        int q = nj * nx + ni;
        if (S[2 * n + q] > .08f) {
          float datumQ =
              riverDatum(World, -64.0f + (float)ni * 128.0f / (float)(nx - 1),
                         (float)nj * dz);
          total += S[q] + S[2 * n + q] - datumQ;
          weight += 1.0f;
        }
      }
      if (weight > 0.0f)
        break;
    }
    e = localDatum + (weight > 0.0f ? total / weight : 0.0f);
  }
  float z = (float)j * dz;
  float seam = smooth(0.0f, 4.0f, z) * (1.0f - smooth(106.0f, 110.0f, z));
  float datum =
      riverDatum(World, -64.0f + (float)i * 128.0f / (float)(nx - 1), z);
  // No datum reset here: neighboring edge cells carry the same live elevation.
  // Small dispersive detail supplements, rather than replaces, simulated depth.
  float current = 3.2f * flow;
  float detail =
      .044f *
          sinf((float)i * .53f + z * 2.6f - time * (current * 2.6f + 2.0f)) +
      .024f *
          sinf((float)i * 1.07f - z * 3.2f + time * (current * 3.2f + 1.2f)) +
      .016f * sinf((float)i * 1.6f + z * 4.7f - time * (current * 4.7f + 3.0f));
  Eta[k] = e + detail * seam * smooth(.06f, .6f, S[2 * n + k]) *
                   (1.0f - S[5 * n + k] * .45f);
}
__global__ void publishRiver(const float *World, const float *S,
                             const float *Eta, const float *Aux, float *Surface,
                             int nx, int nz, float x0, float dx, float dz) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  int i = k % nx, j = k / nx;
  int l = j * nx + max(i - 1, 0), r = j * nx + min(i + 1, nx - 1),
      b = max(j - 1, 0) * nx + i, f = min(j + 1, nz - 1) * nx + i;
  float gx = (Eta[r] - Eta[l]) / (i > 0 && i < nx - 1 ? 2.0f * dx : dx),
        gz = (Eta[f] - Eta[b]) / (j > 0 && j < nz - 1 ? 2.0f * dz : dz);
  Surface[k * 16] = x0 + (float)i * dx;
  Surface[k * 16 + 1] = Eta[k];
  Surface[k * 16 + 2] = (float)j * dz;
  // Short exposure filter follows the local current in CUDA, not a screen blur.
  int si=S[3*n+k]>.6f?1:S[3*n+k]<-.6f?-1:0;
  int sj=S[4*n+k]>.6f?2:S[4*n+k]<-.6f?-2:0;
  int qa=max(0,min(nz-1,j+sj))*nx+max(0,min(nx-1,i+si));
  int qb=max(0,min(nz-1,j-sj))*nx+max(0,min(nx-1,i-si));
  float softFoam=S[5*n+k]*.5f+(S[5*n+qa]+S[5*n+qb])*.25f;
  if(j==0||j==nz-1)softFoam=S[5*n+k];
  Surface[k*16+3]=cap(softFoam+S[6*n+k]*.45f,0.0f,1.0f);
  Surface[k * 16 + 4] = -gx;
  Surface[k * 16 + 5] = 1.0f;
  Surface[k * 16 + 6] = -gz;
  Surface[k * 16 + 7] = Eta[k] - S[n + k];
  Surface[k * 16 + 8] = S[9 * n + k];
  Surface[k * 16 + 9] = S[10 * n + k];
  Surface[k * 16 + 10] = S[3 * n + k];
  Surface[k * 16 + 11] = S[4 * n + k];
  float x = x0 + (float)i * dx, z = (float)j * dz, impact = 0.0f;
  for (int tier = 0; tier < 3; tier++) {
    float landing =
        ledgeStart(World, tier, x) + ledgeWidth(World, tier, x) + .9f;
    float d = (z - landing) / 2.1f;
    impact =
        fmaxf(impact, expf(-d * d) * smooth(.8f, 3.3f, fabsf(S[4 * n + k])) *
                          smooth(.03f, .3f, S[2 * n + k]));
  }
  Surface[k * 16 + 12] = impact;
  Surface[k * 16 + 13] = Aux[2 * n + k];
  float fallSlope =
      (riverDatum(World, x, z - .2f) - riverDatum(World, x, z + .2f)) / .4f;
  Surface[k * 16 + 14] = smooth(.08f, .3f, fallSlope);
  Surface[k * 16 + 15] = 0.0f;
}
// Static scenery is generated once on CUDA. Three only rasterizes these
// buffers.
__global__ void terrainVertices(const float *World, const float *R,
                                float *Terrain, int cols, int rows, int start) {
  int k = start + blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= cols * rows)
    return;
  float x = -85.0f + (float)(k % cols) * 170.0f / (float)(cols - 1),
        z = (float)(k / cols) * 110.0f / (float)(rows - 1);
  float y = riverGround(World, x, z),
        gx = (riverGround(World, x + .09f, z) -
              riverGround(World, x - .09f, z)) /
             .18f,
        gz = (riverGround(World, x, z + .09f) -
              riverGround(World, x, z - .09f)) /
             .18f;
  Terrain[k * 8] = x;
  Terrain[k * 8 + 1] = y;
  Terrain[k * 8 + 2] = z;
  Terrain[k * 8 + 3] = smooth(.08f, .3f, y - riverGround(World, x, z));
  Terrain[k * 8 + 4] = -gx;
  Terrain[k * 8 + 5] = 1.0f;
  Terrain[k * 8 + 6] = -gz;
  Terrain[k * 8 + 7] = 0.0f;
}
__device__ float plantClearance(const float *World, const float *R, float x,
                                float z) {
  float ground = riverGround(World, x, z);
  if (riverBed(World, R, x, z) > ground + .12f)
    return -100.0f;
  return fminf(channelDistance(World, x, z),
               (ground - riverDatum(World, x, z)) * 2.0f);
}
__global__ void treeInstances(const float *World, const float *R, float *Trees,
                              int count) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= count)
    return;
  float z = 2.0f + randomRiver(World, k * 4 + 1001) * 106.0f;
  float x = 0.0f, valid = 0.0f;
  for (int attempt = 0; attempt < 16; attempt++) {
    x = (randomRiver(World, k * 71 + attempt * 131 + 1003) * 2.0f - 1.0f) *
        76.0f;
    if (plantClearance(World, R, x, z) > 3.5f) {
      valid = 1.0f;
      break;
    }
  }
  Trees[k * 4] = x;
  Trees[k * 4 + 1] = riverGround(World, x, z);
  Trees[k * 4 + 2] = z;
  Trees[k * 4 + 3] =
      valid * (3.5f + powf(randomRiver(World, k * 4 + 1004), .8f) * 16.0f);
}
// Material noise from coastal-render.cu, original attribution in CREDITS.md.
__device__ float noiseHash(int x, int y) {
  unsigned int h = (unsigned int)x * 374761393u + (unsigned int)y * 668265263u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return (float)(h ^ (h >> 16)) / 4294967295.0f;
}
__device__ float noiseValue(float x, float y, int p) {
  int ix = (int)floorf(x), iy = (int)floorf(y);
  float a = x - (float)ix, b = y - (float)iy;
  a = a * a * (3.0f - 2.0f * a);
  b = b * b * (3.0f - 2.0f * b);
  int xx = ((ix % p) + p) % p, yy = ((iy % p) + p) % p;
  return (noiseHash(xx, yy) * (1.0f - a) + noiseHash((xx + 1) % p, yy) * a) *
             (1.0f - b) +
         (noiseHash(xx, (yy + 1) % p) * (1.0f - a) +
          noiseHash((xx + 1) % p, (yy + 1) % p) * a) *
             b;
}
__global__ void generateNoise(const float *World, unsigned int *Noise,
                              int size) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= size * size)
    return;
  int x = k % size, y = k / size;
  float s = (float)x / (float)size, t = (float)y / (float)size;
  float value = noiseValue(s * 8.0f, t * 8.0f, 8) * .48f +
                noiseValue(s * 16.0f, t * 16.0f, 16) * .27f +
                noiseValue(s * 32.0f, t * 32.0f, 32) * .15f +
                noiseValue(s * 64.0f, t * 64.0f, 64) * .1f;
  unsigned int r = (unsigned int)floorf(value * 255.0f + .5f),
               g = (unsigned int)floorf(
                   noiseValue(s * 48.0f + 3.1f, t * 48.0f + 8.2f, 48) * 255.0f +
                   .5f);
  unsigned int b = (unsigned int)floorf(noiseHash(x, y) * 255.0f + .5f),
               a = (unsigned int)floorf(
                   noiseValue(s * 128.0f, t * 128.0f, 128) * 255.0f + .5f);
  Noise[k] = r | (g << 8) | (b << 16) | (a << 24);
}

// Dense radial rock meshes retain curved silhouettes independently of terrain
// grid.
__global__ void rockVertices(const float *World, const float *R,
                             float *RockMesh, int count, int start) {
  int k = start + blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= count)
    return;
  int r = k / (65 * 25), v = k % (65 * 25), ring = v / 65, segment = v % 65;
  float theta = (float)segment / 64.0f * 6.2831853f, rr = (float)ring / 24.0f;
  float c = cosf(theta), s = sinf(theta), power = rockExponent(World, R, r),
        edge = rockEdge(World, R, r, theta),
        shape =
            powf(powf(fabsf(c), power) + powf(fabsf(s), power), -1.0f / power);
  float u = c * rr * shape * edge * R[r * 8 + 2],
        offsetV = s * rr * shape * edge * R[r * 8 + 3], ca = cosf(R[r * 8 + 7]),
        sa = sinf(R[r * 8 + 7]);
  float x = R[r * 8] + ca * u - sa * offsetV,
        z = R[r * 8 + 1] + sa * u + ca * offsetV;
  float y = ring == 24 ? riverGround(World, x, z) - .035f
                       : riverRock(World, R, r, x, z);
  float gx = (riverRock(World, R, r, x + .025f, z) -
              riverRock(World, R, r, x - .025f, z)) /
             .05f;
  float gz = (riverRock(World, R, r, x, z + .025f) -
              riverRock(World, R, r, x, z - .025f)) /
             .05f;
  if (ring >= 23) {
    gx = -(ca * c - sa * s) * 4.0f;
    gz = -(sa * c + ca * s) * 4.0f;
  }
  RockMesh[k * 8] = x;
  RockMesh[k * 8 + 1] = fmaxf(y, riverGround(World, x, z) - .035f);
  RockMesh[k * 8 + 2] = z;
  RockMesh[k * 8 + 3] = y - riverGround(World, x, z);
  RockMesh[k * 8 + 4] = -gx;
  RockMesh[k * 8 + 5] = 1.0f;
  RockMesh[k * 8 + 6] = -gz;
  RockMesh[k * 8 + 7] = randomRiver(World, r + 902);
}
// Whorled conifer bough cards with irregular height/radius, generated on CUDA.
// No stacked cone geometry; each tree has a porous three-dimensional crown.
__global__ void foliageVertices(const float *World, const float *Trees,
                                float *Foliage, int count, int start) {
  int k = start + blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= count)
    return;
  int card = k / 4, corner = k % 4, t = card / 96, b = card % 96, layer = b / 8;
  float h = Trees[t * 4 + 3], rnd = randomRiver(World, card * 5 + 8),
        theta = (float)(b % 8) * .78539816f + (float)layer * 2.4f +
                randomRiver(World, t + 41) * 6.28f;
  float species = randomRiver(World, t + 11041),
        crownBase = .10f + randomRiver(World, t + 11042) * .28f;
  float f = crownBase + (float)layer * (1.0f - crownBase) / 12.0f,
        radius = h * powf(1.0f - f, .6f + species * .8f) *
                 (.16f + species * .23f) *
                 (.75f + randomRiver(World, card * 5 + 1) * .5f);
  float along = corner == 1 || corner == 2 ? 1.0f : 0.0f,
        side = corner >= 2 ? 1.0f : -1.0f;
  float bx = cosf(theta), bz = sinf(theta),
        w = radius * (.26f + randomRiver(World, card * 5 + 2) * .1f);
  float x = Trees[t * 4] + bx * (.12f + along * radius) - bz * side * w;
  float z = Trees[t * 4 + 2] + bz * (.12f + along * radius) + bx * side * w;
  float y = Trees[t * 4 + 1] + h * f - along * radius * .22f +
            side * w * (rnd - .5f) * (1.0f + species) +
            randomRiver(World, card + 400) * h * .025f;
  Foliage[k * 8] = x;
  Foliage[k * 8 + 1] = y;
  Foliage[k * 8 + 2] = z;
  Foliage[k * 8 + 3] = species * .65f + rnd * .35f;
  Foliage[k * 8 + 4] = bx * .25f;
  Foliage[k * 8 + 5] = 1.0f;
  Foliage[k * 8 + 6] = bz * .25f;
  Foliage[k * 8 + 7] = f;
}
// Sparse riverbank grasses/fern-like sprays, with placement and shape on CUDA.
__global__ void bankVertices(const float *World, const float *R, float *Bank,
                             int count, int start) {
  int k = start + blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= count)
    return;
  int card = k / 4, c = k % 4, plant = card / 3, blade = card % 3;
  float z = randomRiver(World, plant * 7 + 6001) * 110.0f,
        side = randomRiver(World, plant * 7 + 6002) < .5f ? -1.0f : 1.0f;
  float x = riverCenter(World, z) +
            side * (riverWidth(World, z) + 1.6f +
                    randomRiver(World, plant * 7 + 6003) * 18.0f);
  float valid = 0.0f;
  for (int attempt = 0; attempt < 12; attempt++) {
    if (plantClearance(World, R, x, z) > 3.2f) {
      valid = 1.0f;
      break;
    }
    x = (randomRiver(World, plant * 67 + attempt * 113 + 8001) * 2.0f - 1.0f) *
        58.0f;
  }
  float y = riverGround(World, x, z) - .03f,
        h = valid *
            (.16f + powf(randomRiver(World, plant * 7 + 6004), 1.5f) * 1.15f);
  float angle = randomRiver(World, plant + 6051) * 6.2831853f +
                (float)blade * 2.094f,
        up = c == 1 || c == 2 ? 1.0f : 0.0f, across = c >= 2 ? 1.0f : -1.0f;
  float species = randomRiver(World, plant + 8103);
  float width = h * (.16f + species * .32f);
  Bank[k * 8] = x + cosf(angle) * across * width + sinf(angle) * up * h * .2f;
  Bank[k * 8 + 1] = y + up * h;
  Bank[k * 8 + 2] =
      z + sinf(angle) * across * width + cosf(angle) * up * h * .2f;
  Bank[k * 8 + 3] = randomRiver(World, plant + 7001);
  Bank[k * 8 + 4] = y;
  Bank[k * 8 + 5] = 1.0f;
  Bank[k * 8 + 6] = 0.0f;
  Bank[k * 8 + 7] = species;
}

// Wetness comes only from wet solver cells around a rock, with a drying memory.
// Distant bank rocks are never assigned a global water-height stripe.
__global__ void rockWetness(const float *World, const float *S, const float *R,
                            float *RockWet, int nx, int nz, float x0, float dx,
                            float dz, float time, int reset) {
  int r = blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= 105)
    return;
  int n = nx * nz, a = r * 8, o = r * 4;
  if (reset != 0) {
    RockWet[o] = -100.0f;
    RockWet[o + 1] = 0.0f;
    RockWet[o + 2] = 0.0f;
    RockWet[o + 3] = time;
    return;
  }
  float dt = cap(time - RockWet[o + 3], 0.0f, .1f), level = -100.0f,
        contact = 0.0f;
  for (int p = 0; p < 20; p++) {
    float theta = (float)p * .314159265f, c = cosf(R[a + 7]),
          s = sinf(R[a + 7]);
    float u = cosf(theta) * R[a + 2] * 1.15f,
          v = sinf(theta) * R[a + 3] * 1.15f, x = R[a] + c * u - s * v,
          z = R[a + 1] + s * u + c * v;
    if (x < x0 || x > x0 + (float)(nx - 1) * dx || z < 0.0f ||
        z > (float)(nz - 1) * dz)
      continue;
    int i = (int)((x - x0) / dx), j = (int)(z / dz), k = j * nx + i;
    float h = S[2 * n + k];
    if (h > .025f && channelDistance(World, x, z) < 1.0f) {
      float splash =
          S[5 * n + k] * smooth(.7f, 4.0f, fabsf(S[4 * n + k])) * .22f;
      level = fmaxf(level, S[k] + h + splash);
      contact = 1.0f;
    }
  }
  RockWet[o] = fmaxf(level, RockWet[o] - dt * .025f);
  RockWet[o + 1] = fmaxf(contact, RockWet[o + 1] * expf(-dt * .035f));
  RockWet[o + 2] = contact;
  RockWet[o + 3] = time;
}

// Snapshot the interior rows before any neighboring section writes its
// boundary.
__global__ void captureEdges(const float *S, float *Edges, int nx, int nz) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= nx * 2)
    return;
  int side = k / nx, i = k % nx, q = (side == 0 ? 1 : nz - 2) * nx + i,
      n = nx * nz;
  Edges[k * 4] = S[q] + S[2 * n + q];
  Edges[k * 4 + 1] = S[3 * n + q];
  Edges[k * 4 + 2] = S[4 * n + q];
  Edges[k * 4 + 3] = S[5 * n + q];
}
// Shared interface values transfer pressure, current and foam in both
// directions. Source buffers are immutable snapshots, avoiding dispatch-order
// feedback.
__global__ void connectEdges(float *S, const float *Edges, const float *UpEdges,
                             const float *DownEdges, int nx, int nz, int hasUp,
                             int hasDown) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= nx * 2)
    return;
  int side = k / nx, i = k % nx, n = nx * nz;
  if ((side == 0 && hasUp == 0) || (side == 1 && hasDown == 0))
    return;
  int other = (1 - side) * nx + i;
  float elevation =
      side == 0 ? UpEdges[other * 4] + 8.0f : DownEdges[other * 4] - 8.0f;
  float u = side == 0 ? UpEdges[other * 4 + 1] : DownEdges[other * 4 + 1];
  float v = side == 0 ? UpEdges[other * 4 + 2] : DownEdges[other * 4 + 2];
  float foam = side == 0 ? UpEdges[other * 4 + 3] : DownEdges[other * 4 + 3];
  elevation = (elevation + Edges[k * 4]) * .5f;
  u = (u + Edges[k * 4 + 1]) * .5f;
  v = (v + Edges[k * 4 + 2]) * .5f;
  foam = v >= 0.0f ? (side == 0 ? foam : Edges[k * 4 + 3])
                   : (side == 0 ? Edges[k * 4 + 3] : foam);
  int q = (side == 0 ? 0 : nz - 1) * nx + i;
  S[2 * n + q] = fmaxf(0.0f, elevation - S[q]);
  S[3 * n + q] = u;
  S[4 * n + q] = v;
  S[5 * n + q] = foam;
}

__global__ void adjustFlow(float *S, int nx, int nz, float ratio) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= n)
    return;
  S[3 * n + k] = cap(S[3 * n + k] * ratio, -9.0f, 9.0f);
  S[4 * n + k] = cap(S[4 * n + k] * ratio, -9.0f, 9.0f);
}
