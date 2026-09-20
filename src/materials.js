// Optical shading adapted from coastal-simulation/src/shading.js.
// All geometry and evolving surface fields remain CUDA-generated.
import * as T from 'three/webgpu';
import {
  Fn,
  equirectUV,
  normalLocal,
  If,
  Discard,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  texture,
  positionWorld,
  positionView,
  cameraPosition,
  cameraViewMatrix,
  cameraNear,
  cameraFar,
  screenUV,
  viewportTexture,
  viewportDepthTexture,
  perspectiveDepthToViewZ,
  normalize,
  length,
  dot,
  mix,
  max,
  min,
  clamp,
  smoothstep,
  pow,
  exp,
  abs,
  sin,
  fract,
  reflect,
  reflectVector,
  varying,
  dFdx,
  dFdy,
  fwidth,
  cross,
  transformNormalToView,
  shadow
} from 'three/tsl';
export function riverMaterials(noiseTex, clock, sunLight, environment, wp, wn,
                               wf, tp, tn, rp, rn, impactField, rockContact) {
  const worldOrigin = uniform(new T.Vector3());
  const stablePosition = positionWorld.add(worldOrigin);
  const noise = p => texture(noiseTex, p),
        sun = uniform(new T.Vector3(-.65, .72, .24).normalize()),
        overcast = uniform(.16), sunColor = uniform(new T.Color('#fff0d2'));
  const sky =
      Fn(([ direction ]) =>
             texture(environment.sky, equirectUV(normalize(direction))).rgb);
  const skyMaterial = new T.MeshBasicNodeMaterial(
      {side : T.BackSide, depthWrite : false, fog : false});
  skyMaterial.colorNode = sky(positionWorld.sub(cameraPosition));
  function perturb(n, h) {
    const dx = dFdx(positionWorld), dy = dFdy(positionWorld), r1 = cross(dy, n),
          r2 = cross(n, dx), det = dot(dx, r1);
    const gradient = r1.mul(dFdx(h)).add(r2.mul(dFdy(h))).mul(det.sign());
    return transformNormalToView(normalize(n.mul(abs(det)).sub(gradient)));
  }
  const ground =
      new T.MeshStandardNodeMaterial({roughness : .93, side : T.DoubleSide});
  ground.positionNode = Fn(() => {
    normalLocal.assign(tn.xyz.normalize());
    return tp.xyz;
  })();
  const gn = normalize(varying(tn.xyz)),
        macro = noise(stablePosition.xz.mul(.022)).r,
        fine = noise(stablePosition.xz.mul(1.8)).g;
  const soil = noise(stablePosition.xz.mul(.055)).r,
        gravel = noise(stablePosition.xz.mul(.19)).g,
        litter = noise(stablePosition.xz.mul(.33)).r;
  const pebbles = smoothstep(.49, .62, noise(stablePosition.xz.mul(1.9)).g)
                      .mul(smoothstep(.4, .65, gravel));
  const soilMix = mix(color('#574631'), color('#9c8b69'), soil);
  const patches =
      mix(soilMix, color('#394731'),
          smoothstep(.46, .66, macro).mul(smoothstep(.45, .9, gn.y)));
  const leafMix =
      mix(patches, color('#57402b'), smoothstep(.52, .68, litter).mul(.5));
  ground.colorNode = mix(leafMix, mix(color('#74766c'), color('#b1a58e'), fine),
                         pebbles.mul(.72))
                         .mul(mix(.86, 1.1, fine));
  ground.normalNode =
      perturb(gn, fine.mul(.012)
                      .add(noise(stablePosition.xz.mul(.21)).g.mul(.045))
                      .add(pebbles.mul(.019)));
  ground.envNode = sky(reflectVector).mul(.10);
  const rock = new T.MeshStandardNodeMaterial(
      {roughness : .8, side : T.DoubleSide, alphaTest : .5});
  // The radial apron meets terrain; discard buried/coplanar faces to prevent
  // z-fighting and exposed wedges along a steep cascade.
  rock.opacityNode = smoothstep(.015, .045, varying(rp.w));
  rock.positionNode = Fn(() => {
    normalLocal.assign(rn.xyz.normalize());
    return rp.xyz;
  })();
  const rockN = normalize(varying(rn.xyz));
  const weights = pow(abs(rockN), vec3(4)),
        weight = weights.div(weights.x.add(weights.y).add(weights.z));
  const tri = scale =>
      noise(stablePosition.yz.mul(scale))
          .mul(weight.x)
          .add(noise(stablePosition.xz.mul(scale)).mul(weight.y))
          .add(noise(stablePosition.xy.mul(scale)).mul(weight.z));
  const stoneMacro = tri(.032).r, middle = tri(.25).r, meso = tri(.36).g,
        grain = tri(.8).g,
        fracture = float(1).sub(smoothstep(.015, .08, abs(meso.sub(.5))));
  const contact = varying(rockContact);
  const wet =
      float(1)
          .sub(smoothstep(contact.x.sub(.03),
                          contact.x.add(.14).add(meso.mul(.1)), varying(rp.y)))
          .mul(contact.y);
  const moss = smoothstep(.5, .9, rockN.y)
                   .mul(smoothstep(.48, .68, stoneMacro))
                   .mul(float(1).sub(wet));
  const stone = mix(color('#454943'), color('#a79c80'),
                    stoneMacro.mul(.58).add(middle.mul(.42)))
                    .mul(mix(.7, 1.17, middle))
                    .mul(mix(.79, 1.1, meso))
                    .mul(mix(1, .78, fracture))
                    .mul(mix(.96, 1.04, grain));
  rock.colorNode =
      mix(stone, color('#455335'), moss.mul(.62)).mul(mix(1, .43, wet));
  rock.roughnessNode = mix(float(.92), float(.28), wet);
  rock.normalNode = perturb(rockN, middle.mul(.022)
                                       .add(meso.mul(.01))
                                       .add(grain.mul(.0015))
                                       .sub(fracture.mul(.003)));
  rock.envNode = sky(reflectVector).mul(.2);
  const water = new T.MeshBasicNodeMaterial(
      {transparent : true, depthWrite : true, side : T.DoubleSide});
  water.positionNode = Fn(() => {
    normalLocal.assign(wn.xyz.normalize());
    return wp.xyz;
  })();
  const state = varying(wp), normalField = varying(wn), flow = varying(wf);
  water.fragmentNode = Fn(() => {
    const depth = max(0, normalField.w);
    If(depth.lessThan(.004), () => Discard());
    const distance = length(cameraPosition.sub(positionWorld));
    // Two overlapping short advection phases move at the simulated m/s
    // velocity. Cross-fading phases prevents indefinitely stretched foam/normal
    // coordinates.
    const phase0 = fract(clock.div(.85)),
          phase1 = fract(clock.div(.85).add(.5)),
          phaseBlend = abs(phase0.mul(2).sub(1));
    const uv0 = stablePosition.xz.sub(flow.zw.mul(phase0.mul(.85))),
          uv1 = stablePosition.xz.sub(flow.zw.mul(phase1.mul(.85)));
    const flowNoise = scale => {
      const trail = flow.zw.mul(.035 * scale);
      const sample = p => noise(p.mul(scale))
                              .mul(.5)
                              .add(noise(p.mul(scale).add(trail)).mul(.25))
                              .add(noise(p.mul(scale).sub(trail)).mul(.25));
      return mix(sample(uv0), sample(uv1), phaseBlend);
    };
    const coarse = flowNoise(.07).rg.sub(.5), small = flowNoise(.28).ga.sub(.5);
    const micro = coarse.mul(.28)
                      .add(small.mul(.16))
                      .mul(float(1).sub(smoothstep(65, 300, distance)))
                      .mul(smoothstep(.03, .3, depth));
    const normal = normalize(normalField.xyz.add(vec3(micro.x, 0, micro.y)));
    const eye = normalize(cameraPosition.sub(positionWorld)),
          ndv = clamp(dot(normal, eye), .015, 1),
          fresnel = float(.021).add(pow(float(1).sub(ndv), 5).mul(.979));
    const n0 = flowNoise(.075).r, n1 = flowNoise(.35).r, n2 = flowNoise(1.35).g;
    const density = state.w.mul(.92),
          lace = n0.mul(.36).add(n1.mul(.42)).add(n2.mul(.22)),
          threshold = float(.74).sub(density.mul(.19)),
          aa = max(.018, fwidth(lace).mul(.8));
    const coverage = smoothstep(threshold.sub(aa), threshold.add(aa), lace)
                         .mul(smoothstep(.025, .15, density));
    const filaments = float(1).sub(
        smoothstep(float(.006).add(density.mul(.008)),
                   float(.032).add(density.mul(.008)), abs(n1.sub(.5))));
    const patches = smoothstep(.42, .65, n0.add(density.mul(.10)));
    const foamLace = filaments.mul(smoothstep(.12, .7, density))
                         .mul(.12)
                         .add(coverage.mul(smoothstep(.4, .85, density)))
                         .mul(patches)
                         .mul(smoothstep(.005, .04, depth))
                         .clamp();
    const falling = varying(impactField.z)
                        .mul(smoothstep(.08, .35, float(1).sub(normal.y)))
                        .mul(smoothstep(.8, 3.0, length(flow.zw)));
    const aeration =
        noise(vec2(stablePosition.x.mul(.28),
                   stablePosition.z.mul(.045).sub(clock.mul(.024))))
            .g;
    const impactWhite =
        varying(impactField.x).mul(flowNoise(.21).r.mul(.34).add(.5));
    const foam =
        max(impactWhite.add(smoothstep(.40, .78, density)
                                .mul(smoothstep(.32, .62, n0))
                                .mul(.48)),
            max(foamLace,
                falling.mul(smoothstep(.18, .68, aeration).mul(.65).add(.18))));
    const screenNormal = cameraViewMatrix.mul(vec4(normal, 0)).xy,
          offset = screenNormal.mul(min(depth, .8))
                       .mul(.025)
                       .div(max(1, distance.mul(.15))),
          refractUV = clamp(screenUV.add(offset), vec2(.002), vec2(.998));
    const behindZ = perspectiveDepthToViewZ(viewportDepthTexture(refractUV),
                                            cameraNear, cameraFar),
          guard = smoothstep(.005, .12, positionView.z.sub(behindZ));
    const background =
        viewportTexture(mix(screenUV, refractUV, guard), float(0)).rgb;
    const opticalDepth = min(depth.div(max(.25, ndv)), 16),
          transmission = exp(vec3(-.67, -.24, -.16).mul(opticalDepth));
    const base =
        mix(color('#326d63'), color('#123f42'), smoothstep(.4, 3, depth));
    const transmitted =
        background.mul(transmission).add(base.mul(vec3(1).sub(transmission)));
    const reflection = sky(reflect(eye.negate(), normal));
    const half = normalize(eye.add(sun)), ndh = max(dot(normal, half), 0),
          ndl = max(dot(normal, sun), 0),
          variance = dot(dFdx(normal), dFdx(normal))
                         .add(dot(dFdy(normal), dFdy(normal)))
                         .mul(.3);
    const a2 = float(.09)
                   .add(foam.mul(.22))
                   .pow(4)
                   .add(variance)
                   .clamp(.00008, .12),
          denominator = ndh.mul(ndh).mul(a2.sub(1)).add(1),
          distribution = a2.div(denominator.mul(denominator).mul(Math.PI));
    const masking = ndl.div(ndl.mul(.92).add(.08))
                        .mul(ndv.div(ndv.mul(.92).add(.08))),
          sunFresnel = float(.021).add(
              pow(float(1).sub(max(dot(eye, half), 0)), 5).mul(.979));
    const visibility = shadow(sunLight).r;
    const glint = distribution.mul(masking)
                      .mul(sunFresnel)
                      .div(max(.06, ndv.mul(4)))
                      .mul(.12)
                      .mul(float(1).sub(overcast.mul(.85)))
                      .mul(visibility);
    const result = mix(transmitted, reflection, fresnel.mul(.92))
                       .add(sunColor.mul(glint))
                       .toVar();
    result.assign(mix(result,
                      mix(color('#afc5c9'), color('#f2f3e9'), visibility)
                          .mul(ndl.mul(.22).add(.78)),
                      foam));
    result.assign(mix(result, color('#b1c2c7'),
                      float(1).sub(exp(distance.mul(-.00025)))));
    return vec4(result, smoothstep(0, .008, depth));
  })();
  return {
    water,
    ground,
    rock,
    skyMaterial,
    sun,
    overcast,
    sunColor,
    worldOrigin
  };
}
