// sharpField.js (v2) : scènes SHARP (Apple) dans Volume Photographique — on s'enfonce dans l'image.
// Fichiers préparés par ml-sharp/volume2.py :
//   Ressources/sharp/IMG_00X_base.spz : gaussiennes SHARP brutes, coupées au rectangle, teinte Floc'h
//   Ressources/sharp/IMG_00X_mol.spz  : couche « molécules » (petites sphères) posée sur la base
// Repère des fichiers : SHARP (x droite, y bas, z devant) avec le plan de la photo à z = 1.
// Sur la carte graphique (dyno de Spark) : taille des molécules, mouvements (comme les points),
// changement de photo : chaque gaussienne, à son tour, se resserre en petite cellule, dérive
// doucement vers le haut et s'efface (l'apparition fait l'inverse). La géométrie reste celle de SHARP (pas d'aplatissement).
import { SplatMesh, dyno } from "@sparkjsdev/spark";

export const sharp = {
  reliefMul: 1.0,   // RELIEF : part de la vraie profondeur SHARP atteinte au fond du scroll (0..1)
  molSize: 1.0,     // TAILLE des molécules
  moveMul: 0.3,     // MOUVEMENT des cellules (1 = amplitude des points ; 0.3 = moins de dispersion au fond du scroll)
  showMol: false,   // ancienne couche molécules séparée (désactivée : une seule matière)
  roundness: 0.5,   // CELLULES : arrondi maximal (atteint au fond du scroll), 0 = gaussiennes SHARP d'origine
  depthGamma: 0.6,  // CADRE : 1 = profondeur SHARP d'origine ; plus petit = fond plus plat, cadre plus stable
  curve: 3,         // DÉGRADATION : exposant ; plus grand = net plus longtemps, puis dispersion rapide à la fin
};

// L'œil de SHARP est placé exactement au départ de la caméra du site (z = 25) : vue de là, la vraie
// scène 3D est la photo, nette. Le scroll fait avancer la caméra dans la scène (le relief se révèle).
// Le plan proche (z = 1 dans les fichiers) arrive à z = 0, comme les points.
const D = 25;
const shared = { t: dyno.dynoFloat(0), time: dyno.dynoFloat(0), round: dyno.dynoFloat(0.5), gamma: dyno.dynoFloat(0.6), prog: dyno.dynoFloat(0) };

const GLSL = (o, i) => `
  ${o.gsplat} = ${i.gsplat};
  // Cadre stable : la profondeur est compressée le long des rayons (z -> z^gamma) ; le fond devient
  // presque un plan qui garde la forme du rectangle, et la vue depuis le départ reste identique (nette).
  float z0 = max(${i.gsplat}.center.z, 0.05);
  float z = pow(z0, ${i.gam});
  ${o.gsplat}.center *= z / z0;
  ${o.gsplat}.scales *= z / z0;
  float fi = float(${i.gsplat}.index);
  float h = fract(sin(fi * 12.9898) * 43758.5453);
  float h2 = fract(sin(fi * 78.233) * 12543.1);
  float h3 = fract(sin(fi * 39.425) * 24634.6);
  // anti-grille : chaque gaussienne décalée au hasard de moins d'un pixel (SHARP en pose une par pixel)
  ${o.gsplat}.center.xy += (vec2(h2, h3) - 0.5) * 1.2 * z / 1288.0;
  // cellules : la gaussienne s'arrondit en partie, sans changer de volume
  float g = pow(max(${i.gsplat}.scales.x * ${i.gsplat}.scales.y * ${i.gsplat}.scales.z, 1e-30), 1.0 / 3.0);
  ${o.gsplat}.scales = mix(${o.gsplat}.scales, vec3(g * z / z0), ${i.rnd}) * ${i.size};
  // au fond du scroll : taille plafonnée (≈ 1,6 pixel de la photo) -> plein de petites cellules nettes au lieu du flou
  float cap = mix(1000.0, 1.6 * z / 1288.0, ${i.prog});
  ${o.gsplat}.scales = min(${o.gsplat}.scales, vec3(cap));
  float ph = fi * 0.3;
  ${o.gsplat}.center.x += sin(${i.time} + ph) * ${i.move} * z;
  ${o.gsplat}.center.y += cos(${i.time} + ph * 1.3) * ${i.move} * z;
  // Changement de photo. Disparition : chaque cellule se resserre, dérive doucement et s'efface.
  // Apparition : sur place, du centre de l'image vers les bords, chaque cellule grandit à sa position.
  float r = clamp(length(vec2(${o.gsplat}.center.x / z / 0.59, ${o.gsplat}.center.y / z / 0.30)) / 1.42, 0.0, 1.0);
  float stag = mix(h, r * 0.8 + h * 0.2, ${i.inn});
  float d = 1.0 - clamp((${i.fade} - stag * 0.6) / 0.4, 0.0, 1.0);
  if (d > 0.0) {
    if (${i.inn} < 0.5) {
      vec3 dir = normalize(vec3(h, h2, h3) * 2.0 - 1.0 + 1e-4);
      ${o.gsplat}.center += dir * d * 0.035 * z;
      ${o.gsplat}.center.y -= d * d * 0.025 * z;
      ${o.gsplat}.scales = mix(${o.gsplat}.scales, vec3(0.0007 * z), smoothstep(0.0, 0.35, d)) * (1.0 - 0.4 * d);
      ${o.gsplat}.rgba.a *= 1.0 - smoothstep(0.45, 1.0, d);
    } else {
      ${o.gsplat}.scales = mix(${o.gsplat}.scales, vec3(0.0006 * z), smoothstep(0.0, 0.5, d)) * (1.0 - 0.7 * d);
      ${o.gsplat}.rgba.a *= 1.0 - smoothstep(0.3, 1.0, d);
    }
  }
`.split("\n").map((l) => l.trim()).filter(Boolean);

function makeLayer(url, isMol) {
  const u = { fade: dyno.dynoFloat(1), move: dyno.dynoFloat(0), size: dyno.dynoFloat(1), inn: dyno.dynoFloat(0) };
  const mesh = new SplatMesh({ url });
  mesh.quaternion.set(1, 0, 0, 0);            // OpenCV -> three.js (y et z retournés)
  mesh.position.set(0, 0, D);
  mesh.scale.setScalar(D);
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const block = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: "float", time: "float", move: "float", size: "float", fade: "float", rnd: "float", gam: "float", prog: "float", inn: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, t: shared.t, time: shared.time, move: u.move, size: u.size, fade: u.fade, rnd: shared.round, gam: shared.gamma, prog: shared.prog, inn: u.inn },
      statements: ({ inputs, outputs }) => GLSL(outputs, inputs),
    });
    return { gsplat: block.outputs.gsplat };
  });
  mesh.updateGenerator();
  mesh.visible = false;
  return { mesh, u, isMol };
}

// Changement de photo automatique, sans chevauchement :
// pause sur la photo -> dissolution en cellules -> noir -> la nouvelle photo se recompose
export const TRANSITION = { wait: 1000, out: 1400, black: 400, in: 1400 }; // millisecondes

export class SharpScenes {
  constructor(parent, count = 7) {
    this.parent = parent;
    this.count = count;
    this.scenes = new Map();   // index -> { base, mol }
    this.current = null;       // photo affichée (ou qui s'efface pendant la transition)
    this.next = null;          // photo qui va apparaître
    this.t0 = 0;               // début de la transition (performance.now)
    this.fadeCur = 1;
    this.fadeNext = 0;
    this.visible = false;
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

  // Une transition est en cours (le scroll doit attendre)
  busy() { return this.next != null; }

  // Image affichée tout de suite (chargement, flèches, retour aux gaussiennes)
  show(i) { this.current = i; this.next = null; this.fadeCur = 1; this.fadeNext = 0; this._get(i); this._apply(); }

  // Lancer le changement de photo (automatique, chronométré)
  startTransition(i) {
    if (i === this.current || this.next != null) return;
    this.next = i; this._get(i); this.t0 = performance.now();
  }

  setVisible(v) { this.visible = v; if (v) this.loadAll(); this._apply(); }

  _apply() {
    for (const [i, s] of this.scenes) {
      const fade = i === this.current ? this.fadeCur : i === this.next ? this.fadeNext : 0;
      for (const layer of [s.base, s.mol]) {
        const on = this.visible && fade > 0 && (!layer.isMol || sharp.showMol);
        layer.mesh.visible = on;
        layer.u.fade.value = fade;
        layer.u.inn.value = i === this.next ? 1 : 0;   // photo qui apparaît
      }
    }
  }

  // Avance la transition selon le temps (pas le scroll)
  _tick() {
    if (this.next == null) return;
    const T = TRANSITION, e = performance.now() - this.t0;
    const ready = this.isReady(this.next);
    if (e < T.wait) { this.fadeCur = 1; this.fadeNext = 0; }
    else if (e < T.wait + T.out) { this.fadeCur = 1 - (e - T.wait) / T.out; this.fadeNext = 0; }
    else if (e < T.wait + T.out + T.black || !ready) { this.fadeCur = 0; this.fadeNext = 0; }   // noir (et on attend la scène si besoin)
    else if (e < T.wait + T.out + T.black + T.in) { this.fadeCur = 0; this.fadeNext = (e - T.wait - T.out - T.black) / T.in; }
    else { this.current = this.next; this.next = null; this.fadeCur = 1; this.fadeNext = 0; }
  }

  // À chaque image. disparity : 0..7 (états du parcours)
  update({ disparity, movement, time }) {
    if (!this.visible) return;
    shared.t.value = Math.min(1, Math.max(0, disparity / 7)) * sharp.reliefMul;
    shared.time.value = time;
    this._tick();
    this._apply();
    const p = Math.pow(Math.min(1, Math.max(0, disparity / 7)), sharp.curve); // 0 au départ, 1 au fond
    shared.round.value = sharp.roundness * p;
    shared.prog.value = p;
    shared.gamma.value = sharp.depthGamma;
    for (const [, s] of this.scenes) {
      for (const l of [s.base, s.mol]) l.u.move.value = (Math.pow(Math.min(1, movement / 0.5), sharp.curve) * 0.5 * 2 * sharp.moveMul) / D; // même amplitude que les points
      s.mol.u.size.value = sharp.molSize;
    }
    const key = [shared.round.value.toFixed(3), sharp.depthGamma, time, this.fadeCur.toFixed(3), this.fadeNext.toFixed(3), sharp.molSize, sharp.moveMul, sharp.showMol].join("|");
    if (key !== this.last) {
      this.last = key;
      for (const [, s] of this.scenes) for (const l of [s.base, s.mol]) {
        if (l.mesh.visible && l.mesh.isInitialized) l.mesh.updateVersion();
      }
    }
  }
}
