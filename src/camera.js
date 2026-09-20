import * as T from 'three/webgpu';
const MOVEMENT = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'
]);
const interfaceEvent = e =>
    e.target instanceof Element &&
    !!e.target.closest('input,button,select,textarea,[contenteditable]');
export class FreeCamera {
  constructor(camera, canvas) {
    this.camera = camera;
    this.position = new T.Vector3();
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.drag = false;
    this.speed = 8;
    this.direction = new T.Vector3();
    this.velocity = new T.Vector3();
    canvas.tabIndex = 0;
    canvas.setAttribute(
        'aria-label',
        'Free camera. Drag to look, WASD to fly, Q/E down/up, Shift to boost.');
    this.setView(0);
    canvas.addEventListener('pointerdown', e => {
      canvas.focus({preventScroll : true});
      this.drag = true;
      this.x = e.clientX;
      this.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag)
        return;
      this.yaw -= (e.clientX - this.x) * .003;
      this.pitch = T.MathUtils.clamp(this.pitch - (e.clientY - this.y) * .0027,
                                     -Math.PI / 2 + .01, Math.PI / 2 - .01);
      this.x = e.clientX;
      this.y = e.clientY;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      canvas.addEventListener(event, () => this.drag = false);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.forward();
      this.position.addScaledVector(
          this.direction, -T.MathUtils.clamp(e.deltaY, -200, 200) * .025);
    }, {passive : false});
    addEventListener('keydown', e => {
      if (interfaceEvent(e) || !MOVEMENT.has(e.code))
        return;
      e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.drag = false;
    });
    addEventListener('focusin', e => {
      if (interfaceEvent(e))
        this.keys.clear();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden)
        this.keys.clear();
    });
  }
  forward() {
    this.direction.set(-Math.sin(this.yaw) * Math.cos(this.pitch),
                       Math.sin(this.pitch),
                       -Math.cos(this.yaw) * Math.cos(this.pitch));
    return this.direction;
  }
  setView(index) {
    const views =
              [
                [ [ 13, 5.5, 94 ], [ -2, -3, 66 ] ],
                [ [ 31, 25, 98 ], [ 0, -2, 59 ] ],
                [ [ 0, -4.2, 88 ], [ -2, -4, 64 ] ]
              ],
          v = views[index];
    this.position.fromArray(v[0]);
    const d = new T.Vector3().fromArray(v[1]).sub(this.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.keys.clear();
  }
  update(dt) {
    const k = this.keys,
          forward = Number(k.has('KeyW') || k.has('ArrowUp')) -
                    Number(k.has('KeyS') || k.has('ArrowDown')),
          side = Number(k.has('KeyD') || k.has('ArrowRight')) -
                 Number(k.has('KeyA') || k.has('ArrowLeft')),
          up = Number(k.has('KeyE')) - Number(k.has('KeyQ'));
    this.velocity.copy(this.forward())
        .multiplyScalar(forward)
        .add(new T.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
                 .multiplyScalar(side));
    this.velocity.y += up;
    if (this.velocity.lengthSq())
      this.position.addScaledVector(
          this.velocity.normalize(),
          dt * this.speed *
              (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1));
    const base = this.origin || 0;
    this.camera.position.set(this.position.x, this.position.y + base * 8,
                             this.position.z - base * 110);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    return this.position.z;
  }
}
