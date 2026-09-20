# v02 appearance correction

- Replaced the smooth green horizon band with higher, multiscale mountain ridges and cooler distant foothills in CUDA.
- Added variation to outer valley slopes while retaining continuous section edges.
- Reduced the overly bright foliage albedo and varied conifer branch angles/heights with stable seeds.

# v02

CUDA realism pass.

- CUDA-generated sky, clouds, distant mountain backdrop and conifer needle atlas; no external sky image.
- Larger seeded river bends and higher valley sides, with heavy fog reduced to light atmosphere.
- Smoothly varying channel widths and depths; seeded shallow rapids, stepped cascades and concentrated drops.
- Wider 257 × 441 simulation grid and 180 candidate trees per section.
- Softer flow-aligned foam and water detail; reflection uses the generated environment.
- Deterministic world selection through `?seed=42`.
- Preserved free flight, 60 FPS ceiling, pooled incremental loading and channel-aware vegetation placement.

Validation: all 26 CUDA entry points compile; browser physics, camera, section continuity, coupling and vegetation checks pass. Streaming and environment checks are recorded in reports. Performance remains device-dependent. CUDA source runs through the reference WebShader compiler on WebGPU, not native NVIDIA CUDA.

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
