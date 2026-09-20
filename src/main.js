// Browser input, camera, and fixed-step GPU dispatch. No CPU water simulation.
import * as T from 'three/webgpu';

import {FreeCamera} from './camera.js';
import {RiverSections} from './sections.js';
import {RiverSolver} from './solver.js';

const $ = id => document.getElementById(id), scene = new T.Scene();
scene.background = new T.Color('#a6bdc0');
scene.fog = new T.FogExp2('#b1c2c7', .007);
const camera = new T.PerspectiveCamera(58, innerWidth / innerHeight, .2, 1100);
let renderer, solver, world, navigation, travel = 94, paused = false, view = 0,
                                         light = 0, ready = false;
const sun = new T.DirectionalLight('#fff0d2', 2.7);
sun.target.position.set(0, -2, 55);
sun.position.set(-78, 84, 84);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -75;
sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75;
sun.shadow.camera.bottom = -75;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.bias = -.0007;
sun.shadow.normalBias = .08;
sun.shadow.autoUpdate = true;
sun.shadow.needsUpdate = true;
scene.add(sun, new T.HemisphereLight('#bed0dd', '#625a43', 1.1));
const errors = [];
function fail(e) {
  errors.push(String(e.stack || e));
  console.error(e);
  ready = false;
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error').textContent =
      'Mountain River requires a WebGPU browser with hardware acceleration. ' +
      (e.message || e);
  renderer?.setAnimationLoop(null);
}
addEventListener('unhandledrejection', e => fail(e.reason));
async function boot() {
  if (!navigator.gpu)
    throw Error('WebGPU is unavailable.');
  renderer = new T.WebGPURenderer({antialias : false});
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend)
    throw Error('WebGPU device unavailable.');
  $('viewport').appendChild(renderer.domElement);
  navigation = new FreeCamera(camera, renderer.domElement);
  solver = await RiverSolver.create(renderer.backend.device);
  solver.runtime.onError = fail;
  world = new RiverSections(renderer, scene, sun, solver, camera);
  document.querySelector('#loading span').textContent =
      'Preparing neighboring river sections...';
  await world.initialize();
  const frameInterval = 1000 / 60;
  let last = performance.now(), nextFrame = last, fpsTime = 0, frames = 0;
  const frameStats = {targetFps : 60, rendered : 0, intervals : []};
  function frame(now) {
    try {
      if (now + .25 < nextFrame)
        return;
      nextFrame += frameInterval;
      // Never render catch-up bursts following a slow frame or background tab.
      if (nextFrame < now)
        nextFrame = now + frameInterval;
      const wallDt = (now - last) / 1000;
      const dt = Math.min(wallDt, .1);
      last = now;
      frameStats.rendered++;
      frameStats.intervals.push(wallDt * 1000);
      if (frameStats.intervals.length > 600)
        frameStats.intervals.shift();
      const section = Math.floor(navigation.position.z / 110);
      if (Math.abs(section - world.origin) > 32)
        world.origin = section;
      navigation.origin = world.origin;
      travel = navigation.update(dt);
      world.flow = solver.flow;
      world.update(travel, dt, paused);
      // The light and its target move together; no section-based shadow reset.
      sun.target.position.copy(camera.position);
      sun.position.copy(camera.position).add(new T.Vector3(-78, 86, 29));
      renderer.render(scene, camera);
      fpsTime += wallDt;
      frames++;
      if (fpsTime > .5) {
        $('fps').textContent = Math.round(frames / fpsTime);
        fpsTime = 0;
        frames = 0;
        $('distance').innerHTML =
            (travel / 1000).toFixed(2) + ' <small>km</small>';
      }
    } catch (e) {
      fail(e);
    }
  }
  window.river = {
    get ready() { return ready; },
    renderer,
    runtime : solver.runtime,
    solver,
    scene,
    sections : world,
    frameStats,
    camera,
    surface : solver.Surface,
    get time() { return solver.time; },
    get distance() { return travel; },
    get paused() { return paused; },
    setTravel(v) {
      travel = v;
      navigation.position.z = v;
      navigation.position.y = 8 - 8 * Math.floor(v / 110);
    },
    navigation,
    snapshot : () => ({
      ready,
      time : solver.time,
      steps : solver.steps,
      travel,
      paused,
      flow : solver.flow,
      view,
      cameraMode : "free",
      position : navigation.position.toArray(),
      chunks : world.chunks.length,
      backend : 'CUDA WebShader / WebGPU',
      waterModel :
          'Coastal finite-volume solver: advected momentum, gravity, limited flux, transported foam',
      errors
    })
  };
  ready = true;
  $('loading').hidden = true;
  renderer.setAnimationLoop(frame);
}
function pause() {
  paused = !paused;
  $('travel').textContent = paused ? 'Resume water' : 'Pause water';
  $('travel').classList.toggle('active', !paused);
}
$('travel').onclick = pause;
$('view').onclick = () => {
  view = (view + 1) % 3;
  navigation?.setView(view);
  $('view').textContent = 'View: ' + [ 'River', 'Overlook', 'Waterline' ][view];
};
$('flow').oninput = e => {
  if (solver)
    solver.flow = +e.target.value;
};
$('light').onclick = () => {
  light = (light + 1) % 3;
  const settings = [
    [ 'Morning', '#a6bdc0', '#ffe6b2', 3.1, 1.05 ],
    [ 'Golden hour', '#b4aaa0', '#ffbb73', 3.6, 1 ],
    [ 'Overcast', '#a0b2b9', '#d9e9f2', 1.2, .95 ]
  ][light];
  $('light').textContent = 'Light: ' + settings[0];
  scene.background.set(settings[1]);
  scene.fog.color.set(settings[1]);
  sun.color.set(settings[2]);
  sun.intensity = settings[3];
  if (world) {
    for (const {world : section} of world.sections.values()) {
      section.shaders.sunColor.value.set(settings[2]);
      section.shaders.overcast.value = light === 2 ? .85 : .16;
    }
  }
  sun.shadow.needsUpdate = true;
  renderer.toneMappingExposure = settings[4];
};
$('hide').onclick = () => document.body.classList.toggle('clean');
addEventListener('keydown', e => {
  if (e.target.matches('input,button'))
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    pause();
  }
  if (e.code === 'KeyH')
    document.body.classList.toggle('clean');
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer?.setSize(innerWidth, innerHeight);
});
boot().catch(fail);
