# v01

First published Mountain River release.

- CUDA WebShader water solver, procedural river terrain, seeded rocks and cascades.
- Seeded subsections and fork/rejoin channels; GPU transfer of water level, current and foam at loaded section boundaries.
- Free-flight camera, flow and lighting controls, water pause, and a 60 FPS render ceiling.
- Ten preallocated section slots, chunked CUDA preparation and incremental water warm-up to avoid allocation/compilation freezes during travel.
- Wet-contact rocks, flow-dependent spray and foam.
- Main-channel/fork-aware tree and grass placement, live submerged-root masking, varied conifer crowns and procedural grass/fern texture detail.

Validation: CUDA entry-point compilation; browser camera, physics, section continuity, flow coupling and vegetation tests; streaming frame-time and allocation checks.

Requires a WebGPU-capable browser and hardware acceleration. Startup prewarms the section pool. Water is a shallow-water heightfield, not a volumetric fluid; boundary coupling does not guarantee global volume conservation. Only nearby sections run the full simulation, and dynamic state is regenerated after a distant section slot is reused. The frame limiter targets 60 FPS; achievable performance depends on the device.
