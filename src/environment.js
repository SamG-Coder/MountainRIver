// CUDA computes the environment. This adapter only copies its GPU output to a
// texture.
import * as T from 'three/webgpu';
export function createEnvironment(renderer, solver) {
  const width = 2048, height = 1024;
  const texture = new T.DataTexture(new Uint8Array(width * height * 4), width,
                                    height, T.RGBAFormat);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.ClampToEdgeWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  solver.Sky = solver.runtime.createBuffer(width * height * 4);
  const batch = solver.runtime.batch();
  solver.dispatch(batch, 'generateSky', {width, height}, width * height);
  batch.endPass();
  batch.encoder.copyBufferToTexture(
      {buffer : solver.Sky.gpuBuffer, bytesPerRow : width * 4},
      {texture : renderer.backend.get(texture).texture}, [ width, height, 1 ]);
  batch.submit();
  renderer.backend.generateMipmaps(texture);
  const size = 512, canopy = new T.DataTexture(new Uint8Array(size * size * 4),
                                               size, size, T.RGBAFormat);
  canopy.magFilter = T.LinearFilter;
  canopy.minFilter = T.LinearMipmapLinearFilter;
  canopy.generateMipmaps = true;
  canopy.needsUpdate = true;
  renderer.initTexture(canopy);
  solver.Canopy = solver.runtime.createBuffer(size * size * 4);
  const foliage = solver.runtime.batch();
  solver.dispatch(foliage, 'generateCanopy', {size}, size * size);
  foliage.endPass();
  foliage.encoder.copyBufferToTexture(
      {buffer : solver.Canopy.gpuBuffer, bytesPerRow : size * 4},
      {texture : renderer.backend.get(canopy).texture}, [ size, size, 1 ]);
  foliage.submit();
  renderer.backend.generateMipmaps(canopy);
  return {sky : texture, canopy};
}
