// Draws a Scene with three.js: atoms and half-bonds as instanced meshes (one per element), the cell
// outline, and an a/b/c axes inset. Renders on demand (after a camera move or a change), not in a loop.

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Vec3 } from '../core/poscar/parse';
import { covalentRadius, elementColor } from '../core/structure/elementData';
import type { Scene, ViewStructure } from '../core/structure/view';

export interface DrawOptions {
  repeat: Vec3;
  cell: boolean;
  /** Multiplies the drawn atom radius (half the covalent radius). */
  atomScale: number;
}

const BOND_RADIUS = 0.11;
const AXIS_COLORS = ['#e5484d', '#30a46c', '#3e63dd'];
const INSET = 110;

const v3 = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);

/** Drawn radius of an atom in Å. */
export function atomRadius(element: string, scale: number): number {
  return Math.max(0.18, 0.5 * covalentRadius(element)) * scale;
}

export class StructureRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private readonly controls: TrackballControls;
  private readonly content = new THREE.Group();
  private readonly highlight: THREE.Mesh;
  /** Marks the atom rotation is centred on. */
  private readonly selection: THREE.Mesh;
  private glide = 0;
  private readonly insetScene = new THREE.Scene();
  private readonly insetCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, -10, 10);
  private readonly insetAxes = new THREE.Group();
  /** For picking: the instanced atom meshes and the scene-atom index of each instance. */
  private atomMeshes: { mesh: THREE.InstancedMesh; atoms: number[] }[] = [];
  private sceneAtoms: Scene['atoms'] = [];
  private radius = 5;
  private center = new THREE.Vector3();
  private lattice: ViewStructure['lattice'] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  private hasView = false;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  /** The controls apply pointer moves in update(): run it every frame while the pointer is down. */
  private loop = 0;
  private interacting = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const light = new THREE.DirectionalLight(0xffffff, 1.9);
    light.position.set(1, 2, 3);
    this.camera.add(light);
    this.scene.add(this.camera, this.content);

    this.highlight = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.selection = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.45 }));
    this.selection.visible = false;
    this.scene.add(this.selection);

    // Trackball rotation is free and relative to the screen, like crystal viewers. (OrbitControls
    // orbits about the up axis it saw when created, and stops at the poles: wrong for a camera whose
    // up is a lattice vector.)
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 3;
    this.controls.zoomSpeed = 1.5;
    this.controls.staticMoving = true;
    this.controls.addEventListener('change', () => this.draw());
    this.controls.addEventListener('start', () => {
      cancelAnimationFrame(this.glide);
      this.interacting = true;
      this.tick();
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.tick(); // apply the last move (a wheel step starts and ends at once)
    });

    this.insetScene.add(this.insetAxes);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  dispose() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.loop);
    cancelAnimationFrame(this.glide);
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Redraws the structure; keeps the camera unless `refit` (or nothing was shown yet). */
  set(structure: ViewStructure, scene: Scene, options: DrawOptions, refit = false) {
    this.clear();
    this.sceneAtoms = scene.atoms;
    this.lattice = structure.lattice;
    const [a, b, c] = structure.lattice.map(v3);
    const R = options.repeat;
    const sa = a.clone().multiplyScalar(R[0]);
    const sb = b.clone().multiplyScalar(R[1]);
    const sc = c.clone().multiplyScalar(R[2]);
    this.center = sa.clone().add(sb).add(sc).multiplyScalar(0.5);

    const segments = scene.atoms.length > 4000 ? [12, 8] : scene.atoms.length > 800 ? [20, 14] : [32, 20];
    const sphere = new THREE.SphereGeometry(1, segments[0], segments[1]);
    const byElement = new Map<string, number[]>();
    scene.atoms.forEach((atom, i) => {
      const list = byElement.get(atom.element) ?? [];
      list.push(i);
      byElement.set(atom.element, list);
    });
    const m = new THREE.Matrix4();
    let extent = 0;
    for (const [element, atoms] of byElement) {
      const material = new THREE.MeshPhongMaterial({ color: elementColor(element), shininess: 60, specular: 0x333333 });
      const mesh = new THREE.InstancedMesh(sphere, material, atoms.length);
      const r = atomRadius(element, options.atomScale);
      atoms.forEach((i, k) => {
        const p = v3(scene.atoms[i].cart);
        m.makeScale(r, r, r).setPosition(p);
        mesh.setMatrixAt(k, m);
        extent = Math.max(extent, p.distanceTo(this.center) + r);
      });
      mesh.computeBoundingSphere();
      this.content.add(mesh);
      this.atomMeshes.push({ mesh, atoms });
    }

    if (scene.bonds.length) {
      const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
      const bondsBy = new Map<string, Scene['bonds']>();
      for (const b of scene.bonds) {
        const list = bondsBy.get(b.element) ?? [];
        list.push(b);
        bondsBy.set(b.element, list);
      }
      const up = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion();
      for (const [element, bonds] of bondsBy) {
        const mesh = new THREE.InstancedMesh(cylinder, new THREE.MeshPhongMaterial({ color: elementColor(element), shininess: 30 }), bonds.length);
        bonds.forEach((bond, k) => {
          const from = v3(bond.from);
          const dir = v3(bond.to).sub(from);
          const len = dir.length();
          q.setFromUnitVectors(up, dir.clone().normalize());
          m.compose(from.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(BOND_RADIUS, len, BOND_RADIUS));
          mesh.setMatrixAt(k, m);
        });
        mesh.computeBoundingSphere();
        this.content.add(mesh);
      }
    }

    // Cell outline: the unit cell, and the supercell when repeated.
    const foreground = new THREE.Color(cssColor('--vscode-foreground', '#888888'));
    const corners = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) => {
      const o = new THREE.Vector3();
      const pts = [o, x, y, z, x.clone().add(y), x.clone().add(z), y.clone().add(z), x.clone().add(y).add(z)];
      const edges = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]];
      return { pts, edges };
    };
    const outline = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, opacity: number) => {
      const { pts, edges } = corners(x, y, z);
      const geometry = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([i, j]) => [pts[i], pts[j]]));
      return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: foreground, transparent: opacity < 1, opacity }));
    };
    if (options.cell) {
      this.content.add(outline(a, b, c, 0.9));
      if (R.some((r) => r > 1)) this.content.add(outline(sa, sb, sc, 0.45));
    }
    for (const p of corners(sa, sb, sc).pts) extent = Math.max(extent, p.distanceTo(this.center));
    this.radius = Math.max(extent, 1);
    this.highlight.visible = false;

    this.buildInset();
    // Otherwise the camera stays as it is, including a centre set on an atom.
    if (refit || !this.hasView) this.resetView();
    this.hasView = true;
    this.render();
  }

  /** The default oblique view: c up, looking mostly along a. */
  resetView() {
    const [a, , c] = this.lattice.map((v) => v3(v).normalize());
    const ex = a.clone().addScaledVector(c, -a.dot(c)).normalize();
    const ey = c.clone().cross(ex).normalize();
    const dir = ex.multiplyScalar(0.85).addScaledVector(ey, -0.45).addScaledVector(c, 0.3).normalize();
    this.look(dir, c);
  }

  /** Looks down lattice vector `axis` (it points at the viewer). */
  viewAlong(axis: 0 | 1 | 2) {
    const v = this.lattice.map((x) => v3(x).normalize());
    this.look(v[axis].clone(), axis === 2 ? v[1].clone() : v[2].clone());
  }

  private look(dir: THREE.Vector3, up: THREE.Vector3) {
    // Screen-up must be perpendicular to the view, or every drag also tilts the picture.
    this.camera.up.copy(up).addScaledVector(dir, -up.dot(dir)).normalize();
    this.camera.position.copy(this.center).addScaledVector(dir, this.radius * 4);
    this.camera.zoom = 1;
    this.controls.target.copy(this.center);
    this.camera.lookAt(this.center);
    this.updateFrustum();
    this.controls.update();
    this.render();
  }

  /**
   * Makes the point the centre of rotation by sliding the camera (and its target) over to it: the
   * viewing direction, up and zoom stay exactly as they are, so the picture only pans.
   */
  focusOn(point: Vec3) {
    cancelAnimationFrame(this.glide);
    const from = this.controls.target.clone();
    const to = v3(point);
    if (from.distanceToSquared(to) < 1e-12) return;
    const offset = this.camera.position.clone().sub(from);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 220);
      const k = 1 - (1 - t) ** 3; // ease out
      this.controls.target.lerpVectors(from, to, k);
      this.camera.position.copy(this.controls.target).add(offset);
      this.draw();
      this.glide = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.glide = requestAnimationFrame(step);
  }

  /** Marks the atom rotation is centred on (or nothing). */
  setSelected(index: number | undefined, atomScale: number) {
    const atom = index === undefined ? undefined : this.sceneAtoms[index];
    this.selection.visible = !!atom;
    if (atom) {
      this.selection.position.copy(v3(atom.cart));
      this.selection.scale.setScalar(atomRadius(atom.element, atomScale) * 1.25);
      (this.selection.material as THREE.MeshBasicMaterial).color.set(cssColor('--vscode-focusBorder', '#0078d4'));
    }
    this.render();
  }

  /** Index into the scene's atoms under the pointer, or undefined. */
  pick(clientX: number, clientY: number): number | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.atomMeshes.map((x) => x.mesh), false)[0];
    if (!hit || hit.instanceId === undefined) return undefined;
    return this.atomMeshes.find((x) => x.mesh === hit.object)?.atoms[hit.instanceId];
  }

  /** Rings the atom (or nothing) with a translucent shell. */
  setHighlight(index: number | undefined, atomScale: number) {
    const atom = index === undefined ? undefined : this.sceneAtoms[index];
    if (!atom) {
      if (this.highlight.visible) {
        this.highlight.visible = false;
        this.render();
      }
      return;
    }
    const r = atomRadius(atom.element, atomScale) * 1.35;
    this.highlight.position.copy(v3(atom.cart));
    this.highlight.scale.setScalar(r);
    (this.highlight.material as THREE.MeshBasicMaterial).color.set(cssColor('--vscode-focusBorder', '#0078d4'));
    this.highlight.visible = true;
    this.render();
  }

  private buildInset() {
    for (const child of [...this.insetAxes.children]) disposeObject(child);
    this.insetAxes.clear();
    this.lattice.forEach((v, i) => {
      const dir = v3(v).normalize();
      this.insetAxes.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, AXIS_COLORS[i], 0.3, 0.16));
      const label = textSprite('abc'[i], AXIS_COLORS[i]);
      label.position.copy(dir.multiplyScalar(1.35));
      this.insetAxes.add(label);
    });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.controls.handleResize();
    this.updateFrustum();
    this.render();
  }

  private updateFrustum() {
    const { clientWidth: w, clientHeight: h } = this.host;
    const aspect = w && h ? w / h : 1;
    const r = this.radius * 1.08;
    const [hw, hh] = aspect >= 1 ? [r * aspect, r] : [r, r / aspect];
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh, near: -this.radius * 20, far: this.radius * 20 });
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    if (this.loop) return;
    const step = () => {
      // TrackballControls scales an orthographic pan by the camera distance over the canvas width;
      // this panSpeed cancels that, so the structure follows the cursor exactly.
      const distance = this.camera.position.distanceTo(this.controls.target);
      this.controls.panSpeed = distance > 0 ? this.renderer.domElement.clientWidth / distance : 1;
      this.controls.update();
      this.loop = this.interacting ? requestAnimationFrame(step) : 0;
    };
    this.loop = requestAnimationFrame(step);
  }

  /** Draws in the next frame. */
  render() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    // Axes inset in the bottom-left corner, turned with the main camera.
    this.insetCamera.position.copy(this.camera.position).sub(this.controls.target).setLength(5);
    this.insetCamera.up.copy(this.camera.up);
    this.insetCamera.lookAt(0, 0, 0);
    this.renderer.setViewport(4, 4, INSET, INSET);
    this.renderer.setScissor(4, 4, INSET, INSET);
    this.renderer.setScissorTest(true);
    this.renderer.clearDepth();
    this.renderer.render(this.insetScene, this.insetCamera);
    this.renderer.setScissorTest(false);
  }

  private clear() {
    for (const child of [...this.content.children]) disposeObject(child);
    this.content.clear();
    this.atomMeshes = [];
  }
}

function disposeObject(o: THREE.Object3D) {
  o.traverse((x) => {
    const mesh = x as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(material) ? material : material ? [material] : []) {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

function textSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.setScalar(0.7);
  return sprite;
}

/** A theme colour from a CSS variable, as a colour three.js understands. */
export function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (!value) return fallback;
  // VS Code sometimes gives #rrggbbaa; three.js wants #rrggbb.
  return /^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : value;
}
