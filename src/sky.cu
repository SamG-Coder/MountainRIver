// Entire environment is synthesized on the GPU; no external sky images.
__device__ float skyCloud(float x, float z, float seed) {
  return noiseValue(x + seed, z, 128) * .50f +
         noiseValue(x * 2.07f + seed, z * 2.07f, 128) * .27f +
         noiseValue(x * 4.13f, z * 4.13f + seed, 128) * .15f +
         noiseValue(x * 8.31f, z * 8.31f, 128) * .08f;
}
__global__ void generateSky(const float *World, unsigned int *Sky, int width,
                            int height) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= width * height)
    return;
  float lon =
      ((float)(k % width) + .5f) / (float)width * 6.2831853f - 3.14159265f;
  float lat = (((float)(k / width) + .5f) / (float)height - .5f) * 3.14159265f;
  float y = sinf(lat), x = cosf(lon) * cosf(lat), z = sinf(lon) * cosf(lat);
  float elev = powf(fmaxf(0.0f, y), .42f),
        seed = boundaryRandom(World, 0, 993) * 41.0f;
  float r = .64f - .48f * elev, g = .76f - .41f * elev, b = .85f - .29f * elev;
  float px = x / fmaxf(.12f, y) * 1.7f, pz = z / fmaxf(.12f, y) * 1.7f;
  float cloud = skyCloud(px, pz, seed),
        cover = smooth(.46f, .66f, cloud) * smooth(.015f, .14f, y);
  float light = cap(
      .70f + (skyCloud(px - .16f, pz + .08f, seed) - cloud) * 3.5f, .25f, 1.0f);
  r = r * (1.0f - cover) + (.32f + light * .62f) * cover;
  g = g * (1.0f - cover) + (.39f + light * .56f) * cover;
  b = b * (1.0f - cover) + (.48f + light * .47f) * cover;
  float ax = cosf(lon), az = sinf(lon);
  float ridge = .065f + noiseValue(ax * 3.0f + seed, az * 3.0f, 128) * .13f +
                fabsf(sinf(lon * 11.0f + seed)) * .018f;
  float ridgeNear = .025f + noiseValue(ax * 5.0f + seed, az * 5.0f, 128) * .07f;
  float mountain = 1.0f - smooth(ridge - .0015f, ridge + .0015f, y);
  float grain = skyCloud(ax * 17.0f + az * 9.0f, y * 65.0f, seed);
  float stone = .17f + grain * .22f;
  float snow = smooth(ridge * .72f, ridge * .95f, y + (grain - .5f) * .055f);
  float mr = stone * (1.0f - snow) + .72f * snow,
        mg = (stone + .04f) * (1.0f - snow) + .77f * snow,
        mb = (stone + .075f) * (1.0f - snow) + .81f * snow;
  r = r * (1.0f - mountain) + mr * mountain;
  g = g * (1.0f - mountain) + mg * mountain;
  b = b * (1.0f - mountain) + mb * mountain;
  float foothill = 1.0f - smooth(ridgeNear - .002f, ridgeNear + .002f, y);
  r = r * (1.0f - foothill) + (.06f + grain * .06f) * foothill;
  g = g * (1.0f - foothill) + (.09f + grain * .085f) * foothill;
  b = b * (1.0f - foothill) + (.075f + grain * .065f) * foothill;
  unsigned int cr = (unsigned int)(cap(r, 0.0f, 1.0f) * 255.0f),
               cg = (unsigned int)(cap(g, 0.0f, 1.0f) * 255.0f),
               cb = (unsigned int)(cap(b, 0.0f, 1.0f) * 255.0f);
  Sky[k] = cr | (cg << 8) | (cb << 16) | (255u << 24);
}
// Fine conifer branch/needle coverage and albedo; generated, never loaded as
// art.
__global__ void generateCanopy(const float *World, unsigned int *Canopy,
                               int size) {
  int k = blockIdx.x * blockDim.x + threadIdx.x;
  if (k >= size * size)
    return;
  float u = ((float)(k % size) + .5f) / (float)size,
        v = ((float)(k / size) + .5f) / (float)size - .5f;
  float span = (1.0f - u) * .49f,
        noise = noiseValue(u * 31.0f, v * 31.0f + 20.0f, 128);
  float branch = u - fabsf(v) * .35f;
  float row = fabsf(branch * 18.0f - floorf(branch * 18.0f) - .5f) / 18.0f;
  float needles = 1.0f - smooth(.006f, .014f, row + noise * .005f);
  float stem = 1.0f - smooth(.004f, .010f, fabsf(v));
  float coverage =
      fmaxf(stem, needles) * (1.0f - smooth(span - .02f, span, fabsf(v)));
  float light = .7f + noise * .5f;
  unsigned int r = (unsigned int)(.12f * light * 255.0f),
               g = (unsigned int)(.22f * light * 255.0f),
               b = (unsigned int)(.065f * light * 255.0f),
               a = (unsigned int)(cap(coverage, 0.0f, 1.0f) * 255.0f);
  Canopy[k] = r | (g << 8) | (b << 16) | (a << 24);
}
