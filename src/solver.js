import {GpuRuntime} from '../vendor/cuda-webshader/runtime/runtime.js';
export const SPRAY_COUNT = 56 * 64;
export const GRID = {
  nx : 193,
  nz : 441,
  x0 : -48,
  z0 : 0,
  dx : 96 / 192,
  dz : 110 / 440
};
export const ENTRIES = [
  'initializeRocks', 'initializeRiver', 'advectMomentum',  'faces',
  'limits',          'limitFlux',       'integrate',       'riverBoundary',
  'transport',       'commitTransport', 'riverFoam',       'reconstructRiver',
  'publishRiver',    'terrainVertices', 'treeInstances',   'waterfallSpray',
  'generateNoise',   'rockVertices',    'foliageVertices', 'bankVertices',
  'rockWetness',     'captureEdges',    'connectEdges',    'adjustFlow'
];
export class RiverSolver {
  static async create(device) {
    const runtime = await GpuRuntime.create({device, uniformCapacity : 262144});
    const source = (await Promise.all([
                     'coastal-kernels.cu', 'river.cu', 'impacts.cu'
                   ].map(async f => (await fetch('src/' + f)).text())))
                       .join('\n');
    const kernels = {};
    for (const entry of ENTRIES)
      kernels[entry] =
          await runtime.kernel(source, {entry, workgroupSize : [ 128, 1, 1 ]});
    return new RiverSolver(runtime, kernels);
  }
  constructor(runtime, kernels, sectionId = 0, seed = 1741) {
    this.sectionId = sectionId;
    this.seed = seed;
    this.grid = GRID;
    this.World = runtime.createBuffer(new Float32Array([ seed, sectionId ]));
    this.runtime = runtime;
    this.kernels = kernels;
    this.bindings = new Map();
    this.n = GRID.nx * GRID.nz;
    this.S = runtime.createBuffer(this.n * 19 * 4);
    this.Aux = runtime.createBuffer(this.n * 4 * 4);
    this.Eta = runtime.createBuffer(this.n * 4);
    this.Edges = runtime.createBuffer(GRID.nx * 2 * 4 * 4);
    this.UpEdges = this.Edges;
    this.DownEdges = this.Edges;
    this.hasUp = 0;
    this.hasDown = 0;
    this.Particles = runtime.createBuffer(SPRAY_COUNT * 12 * 4);
    this.R = runtime.createBuffer(105 * 8 * 4);
    this.Controls = runtime.createBuffer(new Float32Array([ 1, 0, 0 ]));
    this.appliedFlow = 1;
    this.time = 0;
    this.steps = 0;
    this.debt = 0;
    this.flow = 1;
  }
  dispatch(batch, entry, extra = {}, count = this.n) {
    const kernel = this.kernels[entry], values = {
      ...GRID,
      start : 0,
      dt : 1 / 120,
      enhanced : 1,
      time : this.time,
      flow : this.flow,
      closed : 0,
      hasUp : this.hasUp,
      hasDown : this.hasDown,
      ...extra
    };
    const scalars = Object.fromEntries(
        kernel.artifact.metadata.scalars.map(s => [s.name, values[s.name]]));
    let b = this.bindings.get(entry);
    if (!b) {
      b = kernel.bind(Object.fromEntries(kernel.artifact.metadata.bindings.map(
                          s => [s.name, this[s.name]])),
                      scalars);
      this.bindings.set(entry, b);
    } else
      b.setScalars(scalars);
    batch.dispatch(b, [ Math.ceil(count / 128), 1, 1 ]);
  }
  initializationJobs(chunk = 4096) {
    const jobs = [];
    const add = (entry, count, extra = {}, split = false) => {
      for (let start = 0; start < count; start += split ? chunk : count)
        jobs.push({
          entry,
          count : Math.min(split ? chunk : count, count - start),
          extra : {...extra, ...(split ? {start} : {})}
        });
    };
    add('initializeRocks', 105, {count : 105});
    add('initializeRiver', this.n, {}, true);
    add('rockWetness', 105, {reset : 1});
    add('terrainVertices', 341 * 221, {cols : 341, rows : 221}, true);
    add('treeInstances', 100, {count : 100});
    add('rockVertices', 105 * 65 * 25, {count : 105 * 65 * 25}, true);
    add('foliageVertices', 100 * 96 * 4, {count : 100 * 96 * 4}, true);
    add('bankVertices', 2400 * 3 * 4, {count : 2400 * 3 * 4}, true);
    return jobs;
  }
  initialize() {
    const b = this.runtime.batch();
    for (const job of this.initializationJobs(this.n * 3))
      this.dispatch(b, job.entry, job.extra, job.count);
    b.submit();
  }
  reset(sectionId) {
    this.sectionId = sectionId;
    this.hasUp = 0;
    this.hasDown = 0;
    this.appliedFlow = 1;
    this.time = 0;
    this.steps = 0;
    this.debt = 0;
    this.runtime.write(this.World, new Float32Array([ this.seed, sectionId ]));
    const b = this.runtime.batch();
    for (const key of ['S', 'Aux', 'Eta', 'Particles', 'RockWet', 'Spray'])
      b.clear(this[key]);
    b.submit();
  }
  neighbors(up, down) {
    const u = up?.Edges || this.Edges, d = down?.Edges || this.Edges;
    if (this.UpEdges !== u || this.DownEdges !== d)
      this.bindings.delete('connectEdges');
    this.UpEdges = u;
    this.DownEdges = d;
    this.hasUp = up ? 1 : 0;
    this.hasDown = down ? 1 : 0;
  }
  step(batch) {
    if (this.appliedFlow !== this.flow) {
      this.dispatch(batch, 'adjustFlow',
                    {ratio : this.flow / this.appliedFlow});
      this.appliedFlow = this.flow;
    }
    this.time += 1 / 120;
    this.steps++;
    for (const entry of ['advectMomentum', 'faces', 'limits', 'limitFlux',
                         'integrate', 'riverBoundary'])
      this.dispatch(batch, entry);
    if (this.steps % 4 === 0) {
      this.dispatch(batch, 'transport', {dt : 1 / 30});
      this.dispatch(batch, 'commitTransport');
      this.dispatch(batch, 'riverFoam', {dt : 1 / 30});
    }
  }
  publish(batch) {
    this.dispatch(batch, 'rockWetness', {reset : 0}, 105);
    this.dispatch(batch, 'reconstructRiver');
    this.dispatch(batch, 'publishRiver');
    this.dispatch(batch, 'waterfallSpray', {count : SPRAY_COUNT}, SPRAY_COUNT);
  }
  frame(dt, paused, publish = true) {
    const b = this.runtime.batch();
    if (!paused) {
      this.debt += Math.min(dt, .1);
      let steps = 0;
      while (this.debt >= 1 / 120 && steps < 12) {
        this.step(b);
        this.debt -= 1 / 120;
        steps++;
      }
    }
    if (publish)
      this.publish(b);
    b.submit();
  }
  async warmup() {
    for (let block = 0; block < 12; block++) {
      const b = this.runtime.batch();
      for (let i = 0; i < 30; i++)
        this.step(b);
      b.submit();
      await this.runtime.idle();
    }
    const b = this.runtime.batch();
    this.publish(b);
    b.submit();
  }
}
