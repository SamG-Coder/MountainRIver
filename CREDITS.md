# Credits and provenance

This project uses the CUDA water solver and GPU integration approach from the user's local `D:\coastal-simulation` project, a CUDA WebShader port by SamG-Coder of [coastal-simulation by iamtechartist (Techartist)](https://github.com/iamtechartist/coastal-simulation).

`src/coastal-kernels.cu` is derived from that local reference; the river version raises the velocity bound from 5 to 9 m/s. `noiseHash`, `noiseValue` and `generateNoise` in `src/river.cu` are copied from its `src/coastal-render.cu`. The shared storage-buffer and texture-copy adapter follows the reference's `src/gpu-interop.js`. The inherited MIT attribution is retained in `LICENSE`.

The river-specific terrain, boundary conditions, cascades, initialization, render publication, scene and controls were created for Mountain River.

CUDA WebShader compiler/runtime: [SamG-Coder/cuda-webshader](https://github.com/SamG-Coder/cuda-webshader), vendored from the reference. Pinned revision and original provenance are retained in `vendor/cuda-webshader/PROVENANCE.md`, with its license alongside it.

Three.js r185: Copyright © 2010–2026 Three.js authors, MIT. The vendored files retain their license headers. Three provides WebGPU rasterization; CUDA source provides the water simulation and procedural scene data.

The sky, triplanar rock texture, wetness, depth-sensitive refraction, Fresnel/GGX highlights and foam-filament formulas in `src/materials.js` are adapted from the reference `src/shading.js`.
