// GPU buffer/mesh adapter. CUDA owns terrain, rocks, foliage and water data.
import * as T from 'three/webgpu';
import {
  storage,
  vertexIndex,
  instanceIndex,
  positionLocal,
  positionWorld,
  cameraWorldMatrix,
  uniform,
  color,
  mix,
  float,
  sin,
  fract,
  max,
  smoothstep,
  uv,
  length,
  varying,
  vec3,
  texture,
  vec2,
  abs,
  transformNormalToView
} from 'three/tsl';
import {GRID, SPRAY_COUNT} from './solver.js';
import {riverMaterials} from './materials.js';
const ROCK_VERTICES = 105 * 65 * 25, FOLIAGE_VERTICES = 100 * 96 * 4;
function radialTopology() {
  const g = new T.BufferGeometry(), indices = [];
  g.setAttribute('position',
                 new T.BufferAttribute(new Float32Array(ROCK_VERTICES * 3), 3));
  for (let rock = 0; rock < 105; rock++)
    for (let ring = 0; ring < 24; ring++)
      for (let s = 0; s < 64; s++) {
        const k = rock * 65 * 25 + ring * 65 + s;
        indices.push(k, k + 1, k + 65, k + 1, k + 66, k + 65);
      }
  g.setIndex(indices);
  return g;
}
function foliageTopology(count = FOLIAGE_VERTICES) {
  const g = new T.BufferGeometry(), indices = [],
        uvs = new Float32Array(count * 2);
  g.setAttribute('position',
                 new T.BufferAttribute(new Float32Array(count * 3), 3));
  for (let i = 0; i < count / 4; i++) {
    const k = i * 4;
    indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
    uvs.set([ 0, 0, 1, 0, 1, 1, 0, 1 ], i * 8);
  }
  g.setAttribute('uv', new T.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}
export function makeWorld(renderer, solver, scene, sunLight, withSky = true) {
  const attributes = [];
  const runtime = solver.runtime, n = solver.n;
  function shared(key, count) {
    const attr =
        new T.StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
    renderer.backend.createStorageAttribute(attr);
    attributes.push(attr);
    solver[key] = runtime.importBuffer(renderer.backend.get(attr).buffer,
                                       count * 16, key);
    return storage(attr, 'vec4', count).toReadOnly();
  }
  const surface = shared('Surface', n * 4),
        terrain = shared('Terrain', 341 * 221 * 2),
        trees = shared('Trees', 100), spray = shared('Spray', SPRAY_COUNT * 2),
        rocks = shared('RockMesh', ROCK_VERTICES * 2),
        rockWet = shared('RockWet', 105),
        foliage = shared('Foliage', FOLIAGE_VERTICES * 2),
        bank = shared('Bank', 2400 * 3 * 4 * 2), clock = uniform(0);
  const noiseTex =
      new T.DataTexture(new Uint8Array(512 * 512 * 4), 512, 512, T.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = T.RepeatWrapping;
  noiseTex.magFilter = T.LinearFilter;
  noiseTex.minFilter = T.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  renderer.initTexture(noiseTex);
  solver.Noise = runtime.createBuffer(512 * 512 * 4);
  const b = runtime.batch();
  solver.dispatch(b, 'generateNoise', {size : 512}, 512 * 512);
  b.endPass();
  b.encoder.copyBufferToTexture(
      {buffer : solver.Noise.gpuBuffer, bytesPerRow : 512 * 4},
      {texture : renderer.backend.get(noiseTex).texture}, [ 512, 512, 1 ]);
  b.submit();
  renderer.backend.generateMipmaps(noiseTex);
  const noise = p => texture(noiseTex, p),
        wp = surface.element(vertexIndex.mul(4)),
        wn = surface.element(vertexIndex.mul(4).add(1)),
        wf = surface.element(vertexIndex.mul(4).add(2)),
        tp = terrain.element(vertexIndex.mul(2)),
        tn = terrain.element(vertexIndex.mul(2).add(1)),
        rp = rocks.element(vertexIndex.mul(2)),
        rn = rocks.element(vertexIndex.mul(2).add(1));
  const shaders = riverMaterials(
      noiseTex, clock, sunLight, wp, wn, wf, tp, tn, rp, rn,
      surface.element(vertexIndex.mul(4).add(3)),
      rockWet.element(float(vertexIndex).div(65 * 25).floor().toUint()));
  // Reject submerged roots using the live CUDA water surface, including forks.
  const rootDry = root => {
    const ix =
        root.x.sub(GRID.x0).div(GRID.dx).clamp(0, GRID.nx - 1).floor().toUint();
    const iz = root.z.div(GRID.dz).clamp(0, GRID.nz - 1).floor().toUint();
    const level = surface.element(iz.mul(GRID.nx).add(ix).mul(4)).y;
    return smoothstep(.10, .25, root.y.sub(level));
  };
  const treeRoot =
      trees.element(float(vertexIndex).div(96 * 4).floor().toUint());
  const fp = foliage.element(vertexIndex.mul(2)),
        fn = foliage.element(vertexIndex.mul(2).add(1));
  const pine = new T.MeshStandardNodeMaterial(
      {roughness : .95, side : T.DoubleSide, alphaTest : .48});
  pine.positionNode = fp.xyz;
  pine.normalNode = transformNormalToView(varying(fn.xyz).normalize());
  const cardUV = uv(), lateral = abs(cardUV.y.sub(.5)).mul(2),
        shape = float(1).sub(cardUV.x.mul(.85)),
        ragged = noise(cardUV.mul(vec2(.32, .19)).add(varying(fp.w))).g;
  const needle = sin(cardUV.x.mul(95).add(cardUV.y.mul(42))).mul(.05);
  pine.opacityNode =
      smoothstep(shape.add(.08), shape.sub(.18),
                 lateral.add(ragged.sub(.5).mul(.6)).add(needle));
  pine.opacityNode = pine.opacityNode.mul(varying(rootDry(treeRoot.xyz)));
  pine.colorNode = mix(color('#132b21'), color('#5d6d43'),
                       varying(fp.w).mul(.5).add(varying(fn.w).mul(.3)))
                       .mul(ragged.mul(.35).add(.75));
  const tr = trees.element(instanceIndex),
        trunk = new T.MeshStandardNodeMaterial({roughness : 1, alphaTest : .5});
  trunk.opacityNode = varying(rootDry(tr.xyz));
  trunk.positionNode = tr.xyz.add(vec3(
      positionLocal.x, positionLocal.y.mul(tr.w).mul(.95).add(tr.w.mul(.47)),
      positionLocal.z));
  trunk.colorNode = mix(color('#302d23'), color('#665846'),
                        noise(positionWorld.xy.mul(vec2(.4, .035))).g);
  const bp = bank.element(vertexIndex.mul(2)),
        bn = bank.element(vertexIndex.mul(2).add(1)),
        grass = new T.MeshStandardNodeMaterial(
            {side : T.DoubleSide, alphaTest : .5, roughness : 1});
  grass.positionNode = bp.xyz;
  grass.normalNode = transformNormalToView(vec3(0, 1, 0));
  const bladeNoise = noise(uv().mul(vec2(.16, .26)).add(varying(bp.w))).g;
  const bladeShape = float(1).sub(uv().x.mul(.93));
  const species = varying(bn.w), leafUV = uv();
  const stripes =
      abs(fract(leafUV.y.mul(5).add(
                    sin(leafUV.x.mul(3).add(varying(bp.w).mul(9))).mul(.16)))
              .sub(.5))
          .mul(2);
  const bladeMask = smoothstep(bladeShape.mul(.7).add(.08),
                               bladeShape.mul(.7).sub(.09), stripes);
  const fernMask = smoothstep(
      -.3, .25, sin(leafUV.x.mul(48).add(abs(leafUV.y.sub(.5)).mul(17))));
  const silhouette = smoothstep(bladeShape.add(.05), bladeShape.sub(.2),
                                abs(leafUV.y.sub(.5)).mul(2));
  grass.opacityNode = silhouette.mul(mix(
      bladeMask,
      max(fernMask, float(1).sub(smoothstep(.025, .06, abs(leafUV.y.sub(.5))))),
      smoothstep(.65, .75, species)));
  grass.opacityNode =
      grass.opacityNode.mul(varying(rootDry(vec3(bp.x, bn.x, bp.z))));
  const vein =
      sin(leafUV.y.mul(170).add(varying(bp.w).mul(20))).mul(.05).add(.9);
  const dryTip =
      smoothstep(.65, 1, leafUV.x).mul(smoothstep(.45, .9, varying(bp.w)));
  const greens = mix(color('#243c21'), color('#718348'),
                     species.mul(.6).add(bladeNoise.mul(.4)));
  grass.colorNode = mix(greens, color('#a99860'), dryTip.mul(.7))
                        .mul(vein)
                        .mul(leafUV.x.mul(.3).add(.65))
                        .mul(bladeNoise.mul(.35).add(.8));
  const sp = spray.element(instanceIndex.mul(2)),
        ss = spray.element(instanceIndex.mul(2).add(1)),
        mist = new T.MeshBasicNodeMaterial(
            {transparent : true, depthWrite : false, color : '#dfe8df'});
  mist.positionNode =
      sp.xyz.add(cameraWorldMatrix[0].xyz.mul(positionLocal.x.mul(ss.x)))
          .add(cameraWorldMatrix[1].xyz.mul(positionLocal.y.mul(ss.y)));
  mist.opacityNode = varying(sp.w).mul(
      float(1).sub(smoothstep(.06, .5, length(uv().sub(.5)))));
  const waterGeo = new T.PlaneGeometry(1, 1, GRID.nx - 1, GRID.nz - 1),
        terrainGeo = new T.PlaneGeometry(1, 1, 340, 220),
        rockGeo = radialTopology(), pineGeo = foliageTopology(),
        bankGeo = foliageTopology(2400 * 3 * 4),
        trunkGeo = new T.CylinderGeometry(.09, .23, 1, 7),
        sprayGeo = new T.PlaneGeometry(1, 1), chunks = [];
  for (let i = 0; i < 1; i++) {
    const g = new T.Group(), land = new T.Mesh(terrainGeo, shaders.ground),
          rock = new T.Mesh(rockGeo, shaders.rock),
          leaves = new T.Mesh(pineGeo, pine),
          trunks = new T.InstancedMesh(trunkGeo, trunk, 100),
          water = new T.Mesh(waterGeo, shaders.water),
          sprayMesh = new T.InstancedMesh(sprayGeo, mist, SPRAY_COUNT);
    land.receiveShadow = rock.receiveShadow = leaves.receiveShadow =
        trunks.receiveShadow = true;
    rock.castShadow = leaves.castShadow = trunks.castShadow = i < 3;
    water.renderOrder = 3;
    sprayMesh.renderOrder = 4;
    const plants = new T.Mesh(bankGeo, grass);
    plants.receiveShadow = true;
    g.add(land, rock, leaves, trunks, water, sprayMesh, plants);
    g.children.forEach(m => m.frustumCulled = false);
    scene.add(g);
    chunks.push(g);
  }
  const sky =
      new T.Mesh(new T.SphereGeometry(850, 32, 16), shaders.skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  if (withSky)
    scene.add(sky);
  return {
    chunks,
    clock,
    shaders,
    dispose() {
      for (const g of chunks)
        scene.remove(g);
      scene.remove(sky);
      for (const a of attributes)
        renderer.backend.destroyAttribute(a);
      for (const g of [waterGeo, terrainGeo, rockGeo, pineGeo, bankGeo,
                       trunkGeo, sprayGeo, sky.geometry])
        g.dispose();
      for (const m of [shaders.water, shaders.ground, shaders.rock,
                       shaders.skyMaterial, pine, trunk, grass, mist])
        m.dispose();
      noiseTex.dispose();
      for (const resource of Object.values(solver))
        if (resource?.gpuBuffer && resource.owned && !resource.destroyed)
          runtime.destroyBuffer(resource);
    },
    update(origin = 0, camera = null) {
      const offset = solver.sectionId - origin;
      shaders.worldOrigin.value.set(0, -8 * origin, 110 * origin);
      chunks[0].position.set(0, -8 * offset, 110 * offset);
      if (camera)
        sky.position.copy(camera.position);
      clock.value = solver.time;
    }
  };
}
