// sharpField.js (v2) : scènes SHARP (Apple) dans Volume Photographique — on s'enfonce dans l'image.
// Fichiers préparés par ml-sharp/volume2.py :
//   Ressources/sharp/IMG_00X_base.spz : gaussiennes SHARP brutes, coupées au rectangle, teinte Floc'h
//   Ressources/sharp/IMG_00X_mol.spz  : couche « molécules » (petites sphères) posée sur la base
// Repère des fichiers : SHARP (x droite, y bas, z devant) avec le plan de la photo à z = 1.
// Sur la carte graphique (dyno de Spark), avec t = avancement du relief (0..1) :
//   profondeur  zt = 1 + (z - 1) t           (t = 0 : tout sur le plan z = 1 = photo plate et nette)
//   étalement   spread = 1 + (zt - 1) t      (début : poussée droit vers l'arrière, comme les points ;
//                                             fin (t = 1) : vraie géométrie SHARP, vue depuis son point de vue)
import { SplatMesh, dyno } from "@sparkjsdev/spark";

export const sharp = {
  reliefMul: 1.0,   // RELIEF : part de la vraie profondeur SHARP atteinte au fond du scroll (0..1)
  molSize: 1.0,     // TAILLE des molécules
  moveMul: 1.0,     // MOUVEMENT des molécules
  showMol: true,    // afficher la couche molécules
};

const D = 29.3;     // le plan z = 1 devient le rectangle des points (34,4 unités de large) à z = 0
const shared = { t: dyno.dynoFloat(0), time: dyno.dynoFloat(0) };

const GLSL = (o, i) => `
  ${o.gsplat} = ${i.gsplat};
  float z = max(${i.gsplat}.center.z, 0.05);
  float zt = 1.0 + (z - 1.0) * ${i.t};
  float spread = 1.0 + (zt - 1.0) * ${i.t};
  ${o.gsplat}.center = vec3(${i.gsplat}.center.xy / z * spread, zt);
  ${o.gsplat}.scales *= spread / z * ${i.size};
  float ph = float(${i.gsplat}.index) * 0.3;
  ${o.gsplat}.center.x += sin(${i.time} + ph) * ${i.move} * spread;
  ${o.gsplat}.center.y += cos(${i.time} + ph * 1.3) * ${i.move} * spread;
  float h = fract(sin(float(${i.gsplat}.index) * 12.9898) * 43758.5453);
  if (h > ${i.fade}) ${o.gsplat}.rgba.a = 0.0;
`.split("\n").map((l) => l.trim()).filter(Boolean);

function makeLayer(url, isMol) {
  const u = { fade: dyno.dynoFloat(1), move: dyno.dynoFloat(0), size: dyno.dynoFloat(1) };
  const mesh = new SplatMesh({ url });
  mesh.quaternion.set(1, 0, 0, 0);            // OpenCV -> three.js (y et z retournés)
  mesh.position.set(0, 0, D);
  mesh.scale.setScalar(D);
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const block = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: "float", time: "float", move: "float", size: "float", fade: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, t: shared.t, time: shared.time, move: u.move, size: u.size, fade: u.fade },
      statements: ({ inputs, outputs }) => GLSL(outputs, inputs),
    });
    return { gsplat: block.outputs.gsplat };
  });
  mesh.updateGenerator();
  mesh.visible = false;
  return { mesh, u, isMol };
}

export class SharpScenes {
  constructor(parent, count = 7) {
    this.parent = parent;
    this.count = count;
    this.scenes = new Map();   // index -> { base, mol }
    this.current = null;
    this.previous = null;
    this.visible = false;
    this.mix = 1;
    this.last = "";
  }

  // Charger les 7 scènes d'un coup (pour des transitions sans attente)
  loadAll() {
    for (let i = 1; i <= this.count; i++) this._get(i);
  }

  _get(i) {
    let s = this.scenes.get(i);
    if (!s) {
      s = {
        base: makeLayer(`./Ressources/sharp/IMG_00${i}_base.spz`, false),
        mol: makeLayer(`./Ressources/sharp/IMG_00${i}_mol.spz`, true),
      };
      this.parent.add(s.base.mesh, s.mol.mesh);
      this.scenes.set(i, s);
    }
    return s;
  }

  isReady(i) { const s = this.scenes.get(i); return !!(s && s.base.mesh.isInitialized && s.mol.mesh.isInitialized); }

  show(i) { this.current = i; this.previous = null; this.mix = 1; this._get(i); this._apply(); }

  crossTo(i) {
    if (i === this.current) return;
    this.previous = this.current; this.current = i; this.mix = 0; this._get(i); this._apply();
  }

  setVisible(v) { this.visible = v; if (v) this.loadAll(); this._apply(); }

  _apply() {
    for (const [i, s] of this.scenes) {
      const fade = i === this.current ? this.mix : i === this.previous ? 1 - this.mix : 0;
      for (const layer of [s.base, s.mol]) {
        const on = this.visible && fade > 0 && (!layer.isMol || sharp.showMol);
        layer.mesh.visible = on;
        layer.u.fade.value = fade;
      }
    }
  }

  // À chaque image. disparity : 0..7 (états du parcours) ; mix : avancement de la transition (0..1)
  update({ disparity, movement, time, mix = 1 }) {
    if (!this.visible) return;
    shared.t.value = Math.min(1, Math.max(0, disparity / 7)) * sharp.reliefMul;
    shared.time.value = time;
    if (this.previous != null) {
      this.mix = Math.min(1, Math.max(0, mix));
      if (this.mix >= 1) this.previous = null;
    }
    this._apply();
    for (const [, s] of this.scenes) {
      s.mol.u.move.value = (movement * 2 * sharp.moveMul) / D;   // même amplitude que les points
      s.mol.u.size.value = sharp.molSize;
    }
    const key = [shared.t.value.toFixed(4), time, this.mix.toFixed(3), sharp.molSize, sharp.moveMul, sharp.showMol].join("|");
    if (key !== this.last) {
      this.last = key;
      for (const [, s] of this.scenes) for (const l of [s.base, s.mol]) {
        if (l.mesh.visible && l.mesh.isInitialized) l.mesh.updateVersion();
      }
    }
  }
}
