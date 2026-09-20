// Persistent impact particles. 20 rock contacts, 36 ledge impact lanes, 64
// slots each.
__global__ void waterfallSpray(const float *World, const float *S,
                               const float *Eta, const float *R,
                               float *Particles, float *Spray, int count,
                               int nx, int nz, float x0, float dx, float dz,
                               float time) {
  int k = blockIdx.x * blockDim.x + threadIdx.x, n = nx * nz;
  if (k >= count)
    return;
  int emitter = k / 64, slot = k % 64, p = k * 12, o = k * 8;
  float life = Particles[p + 7], birth = Particles[p + 3];
  if (life <= 0.0f || time > birth + life) {
    int cycle = (int)(time * 3.7f);
    float a = randomRiver(World, k * 17 + cycle * 37),
          b = randomRiver(World, k * 23 + cycle * 71),
          c = randomRiver(World, k * 31 + cycle * 97);
    float x = 0.0f, z = 0.0f, sampleZ = 0.0f, radius = .5f, drop = 0.0f;
    if (emitter < 20) {
      int r = emitter * 8;
      x = R[r] + (a - .5f) * R[r + 2] * 1.1f;
      z = R[r + 1] - R[r + 3] * 1.05f;
      sampleZ = z - .35f;
      radius = R[r + 2] * .2f;
    } else {
      int tier = (emitter - 20) / 12, lane = (emitter - 20) % 12;
      float nominal = tier == 0 ? 32.0f : tier == 1 ? 63.0f : 86.0f;
      x = riverCenter(World, nominal) + ((float)lane / 11.0f * 2.0f - 1.0f) *
                                            riverWidth(World, nominal) * .91f;
      sampleZ = ledgeStart(World, tier, x) - .5f;
      z = ledgeStart(World, tier, x) + ledgeWidth(World, tier, x) + .7f;
      radius = .8f;
      drop = ledgeHeight(World, tier);
    }
    int i = (int)cap((x - x0) / dx, 0.0f, (float)nx - 1.0f),
        j = (int)cap(sampleZ / dz, 0.0f, (float)nz - 1.0f), q = j * nx + i;
    int landingJ = (int)cap(z / dz, 0.0f, (float)nz - 1.0f),
        landing = landingJ * nx + i;
    float depth = S[2 * n + q], u = S[3 * n + q], v = S[4 * n + q],
          speed = sqrtf(u * u + v * v);
    float force = smooth(.65f, 3.3f, speed) * smooth(.035f, .3f, depth);
    if (emitter < 20)
      force *=
          smooth(.05f, .65f, R[emitter * 8 + 5] + R[emitter * 8 + 4] - Eta[q]);
    float kind = slot % 10 == 0 ? 2.0f : slot % 4 == 0 ? 1.0f : 0.0f;
    float lifetime = kind == 2.0f   ? .7f + c * .7f
                     : kind == 1.0f ? .20f + c * .22f
                                    : .28f + c * .48f;
    Particles[p] = x + (a - .5f) * radius * 2.0f;
    Particles[p + 1] = Eta[landing] + .035f;
    Particles[p + 2] = z + (b - .5f) * .65f;
    Particles[p + 3] = time + randomRiver(World, k + cycle * 53) * .45f;
    Particles[p + 4] = u * .2f + (a - .5f) * (1.3f + force * 2.2f);
    Particles[p + 5] = (1.2f + b * 2.8f + sqrtf(drop) * .55f) * force;
    Particles[p + 6] = v * .18f + (c - .4f) * 1.8f;
    Particles[p + 7] = lifetime;
    Particles[p + 8] = force;
    Particles[p + 9] = kind;
    Particles[p + 10] = a;
    Particles[p + 11] = b;
    birth = Particles[p + 3];
    life = lifetime;
  }
  float age = time - birth, t = cap(age / life, 0.0f, 1.0f),
        kind = Particles[p + 9], force = Particles[p + 8];
  float drag = kind == 2.0f ? 2.4f : .5f,
        flight = (1.0f - expf(-drag * fmaxf(age, 0.0f))) / drag;
  float x = Particles[p] + Particles[p + 4] * flight,
        y = Particles[p + 1] + Particles[p + 5] * flight -
            (kind == 2.0f ? .4f : 4.905f) * age * age,
        z = Particles[p + 2] + Particles[p + 6] * flight;
  int i = (int)cap((x - x0) / dx, 0.0f, (float)nx - 1.0f),
      j = (int)cap(z / dz, 0.0f, (float)nz - 1.0f), q = j * nx + i;
  float visible = age > 0.0f && age < life && y > Eta[q] - .04f ? 1.0f : 0.0f,
        fade = sinf(t * 3.14159265f) * force * visible;
  float size = kind == 2.0f   ? .18f + t * .8f
               : kind == 1.0f ? .025f + .018f * Particles[p + 10]
                              : .009f + .018f * Particles[p + 10];
  Spray[o] = x;
  Spray[o + 1] = y;
  Spray[o + 2] = z;
  Spray[o + 3] = fade * (kind == 2.0f ? .075f : kind == 1.0f ? .38f : .52f);
  Spray[o + 4] = size;
  Spray[o + 5] = size * (kind == 1.0f ? 3.0f : 1.0f);
  Spray[o + 6] = kind;
  Spray[o + 7] = Particles[p + 11];
}
