// Render resources are prepared once behind the loading screen. Streaming only
// regenerates CUDA data in a hidden spare slot, in bounded batches across
// frames.
import {createEnvironment} from './environment.js';
import {makeWorld} from './scene.js';
import {RiverSolver} from './solver.js';

export class RiverSections {
  constructor(renderer, scene, sun, template, camera) {
    Object.assign(this, {renderer, scene, sun, template, camera});
    this.sections = new Map();
    this.spares = [];
    this.pending = null;
    this.origin = 0;
    this.flow = 1;
    this.error = null;
    this.time = 3;
    this.stats = {
      poolSize : 0,
      completed : 0,
      preparationBatches : 0,
      maxPreparationCpuMs : 0
    };
  }
  async initialize() {
    this.environment = createEnvironment(this.renderer, this.template);
    const ids = [ 0, -1, 1, -2, 2, -3, 3, null, null, null ];
    for (const id of ids) {
      document.querySelector("#loading span").textContent =
          `Preparing river surroundings ${this.stats.poolSize + 1}/${
              ids.length}...`;
      const solver = id === 0 ? this.template
                              : new RiverSolver(this.template.runtime,
                                                this.template.kernels, id ?? 0,
                                                this.template.seed);
      const world = makeWorld(this.renderer, solver, this.scene, this.sun,
                              id === 0, this.environment);
      solver.initialize();
      if (id !== null)
        await solver.warmup();
      world.update(this.origin, this.camera);
      await this.renderer.compileAsync(world.chunks[0], this.camera,
                                       this.scene);
      // Also upload topology and create shadow/render bindings before play.
      this.renderer.render(this.scene, this.camera);
      await solver.runtime.idle();
      const entry = {solver, world};
      if (id === null) {
        world.chunks[0].visible = false;
        this.spares.push(entry);
      } else
        this.sections.set(id, entry);
      this.stats.poolSize++;
    }
  }
  prepare(base) {
    if (!this.pending) {
      // Eviction returns an existing slot; no allocations, disposal, or new
      // render pipelines are allowed in the travel path. Keep origin for
      // API/sky.
      for (const [id, entry] of this.sections)
        if (Math.abs(id - base) > 3 && id !== 0) {
          entry.world.chunks[0].visible = false;
          this.sections.delete(id);
          this.spares.push(entry);
        }
      const wanted =
          [ base, base - 1, base + 1, base - 2, base + 2, base - 3, base + 3 ];
      const id = wanted.find(id => !this.sections.has(id));
      if (id === undefined || !this.spares.length)
        return;
      const entry = this.spares.pop();
      entry.solver.reset(id);
      this.pending = {
        id,
        entry,
        jobs : entry.solver.initializationJobs(),
        index : 0,
        warmup : 0,
        busy : false
      };
    }
    const job = this.pending;
    if (job.busy)
      return;
    const start = performance.now(), s = job.entry.solver,
          b = s.runtime.batch();
    s.flow = this.flow;
    if (job.index < job.jobs.length) {
      const part = job.jobs[job.index++];
      s.dispatch(b, part.entry, part.extra, part.count);
    } else if (job.warmup < 360) {
      // Two fixed steps, not the previous burst of thirty per queue submission.
      for (let i = 0; i < 2; i++) {
        s.step(b);
        job.warmup++;
      }
    } else
      s.publish(b);
    b.submit();
    job.busy = true;
    this.stats.preparationBatches++;
    this.stats.maxPreparationCpuMs =
        Math.max(this.stats.maxPreparationCpuMs, performance.now() - start);
    const finished = job.index === job.jobs.length && job.warmup >= 360 &&
                     s.Surface && job.published;
    if (job.index === job.jobs.length && job.warmup >= 360)
      job.published = true;
    s.runtime.idle()
        .then(() => {
          job.busy = false;
          if (finished) {
            const {world} = job.entry,
                  current = this.sections.get(0).world.shaders;
            world.shaders.sunColor.value.copy(current.sunColor.value);
            world.shaders.overcast.value = current.overcast.value;
            world.update(this.origin, this.camera);
            this.sections.set(job.id, job.entry);
            this.pending = null;
            this.stats.completed++;
          }
        })
        .catch(e => this.error = e);
  }
  update(travel, dt, paused) {
    if (this.error)
      throw this.error;
    const base = Math.floor(travel / 110);
    if (!paused)
      this.time += dt;
    for (const [id, {solver, world}] of this.sections) {
      solver.neighbors(this.sections.get(id - 1)?.solver,
                       this.sections.get(id + 1)?.solver);
      solver.flow = this.flow;
      if (Math.abs(id - base) <= 1)
        solver.frame(dt, paused, false);
      world.update(this.origin, this.camera);
      world.clock.value = this.time;
      world.chunks[0].visible = Math.abs(id - base) <= 3;
    }
    const batch = this.template.runtime.batch();
    if (!paused)
      for (const {solver} of this.sections.values())
        if (solver.appliedFlow !== this.flow) {
          solver.dispatch(batch, 'adjustFlow',
                          {ratio : this.flow / solver.appliedFlow});
          solver.appliedFlow = this.flow;
        }
    for (const {solver} of this.sections.values())
      solver.dispatch(batch, 'captureEdges', {}, solver.grid.nx * 2);
    if (!paused)
      for (const {solver} of this.sections.values())
        solver.dispatch(batch, 'connectEdges', {}, solver.grid.nx * 2);
    for (const [id, {solver}] of this.sections)
      if (Math.abs(id - base) <= 1)
        solver.publish(batch);
    batch.submit();
    this.prepare(base);
  }
  get chunks() {
    return [...this.sections.values() ].flatMap(e => e.world.chunks);
  }
  get shaders() { return this.sections.get(0).world.shaders; }
}
