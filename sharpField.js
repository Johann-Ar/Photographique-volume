// sharpField.js (v2) : scènes SHARP (Apple) dans Volume Photographique — on s'enfonce dans l'image.
// Fichiers préparés par ml-sharp/volume2.py :
//   Ressources/sharp/IMG_00X_base.spz : gaussiennes SHARP brutes, coupées au rectangle, teinte Floc'h
//   Ressources/sharp/IMG_00X_mol.spz  : couche « molécules » (petites sphères) posée sur la base
// Repère des fichiers : SHARP (x droite, y bas, z devant) avec le plan de la photo à z = 1.
// Sur la carte graphique (dyno de Spark) : taille des molécules, mouvements (comme les points),
// changement de photo : chaque gaussienne, à son tour, se resserre en petite cellule, dérive
// doucement vers le haut et s'efface (l'apparition fait l'inverse). La géométrie reste celle de SHARP (pas d'aplatissement).
import { SplatMesh, dyno, unpackSplat } from "@sparkjsdev/spark";

export const sharp = {
  reliefMul: 1.0,   // RELIEF : part de la vraie profondeur SHARP atteinte au fond du scroll (0..1)
  molSize: 1.0,     // TAILLE des molécules
  moveMul: 0.3,     // MOUVEMENT des cellules (1 = amplitude des points ; 0.3 = moins de dispersion au fond du scroll)
  showMol: true,    // matière cellulaire (ml-sharp/cells.py : chaque gaussienne décomposée en cellules)
  cellFrom: 0.2,   // la matière cellulaire commence à remplacer le SHARP lisse à ce stade (0..1 du parcours)
  cellTo: 0.75,     // ... et domine à partir d'ici (en plus, la matière proche de la caméra passe en cellules)
  cellMove: 0.4,    // mouvement des cellules (1 = même amplitude que les points)
  roundness: 0.95,  // CELLULES : arrondi atteint au fond du scroll (tout en cellules), 0 = gaussiennes SHARP d'origine
  progress: 0,      // avancement de la dégradation (0..1), lu par gs.html pour le bord des cellules
  depthGamma: 0.6,  // CADRE : 1 = profondeur SHARP d'origine ; plus petit = fond plus plat, cadre plus stable
  curve: 3,         // DÉGRADATION : exposant ; plus grand = net plus longtemps, puis dispersion rapide à la fin
};

// L'œil de SHARP est placé exactement au départ de la caméra du site (z = 25) : vue de là, la vraie
// scène 3D est la photo, nette. Le scroll fait avancer la caméra dans la scène (le relief se révèle).
// Le plan proche (z = 1 dans les fichiers) arrive à z = 0, comme les points.
const D = 25;
const shared = { t: dyno.dynoFloat(0), time: dyno.dynoFloat(0), round: dyno.dynoFloat(0.5), gamma: dyno.dynoFloat(0.6), prog: dyno.dynoFloat(0), camZ: dyno.dynoFloat(0), cellR: dyno.dynoFloat(0) };

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
  // (nul au début du parcours : au passage photo 2D -> SHARP les deux images se superposent au pixel près)
  ${o.gsplat}.center.xy += (vec2(h2, h3) - 0.5) * 1.2 * z / 1288.0 * clamp(${i.t} * 4.0, 0.0, 1.0);
  // cellules : la gaussienne s'arrondit en partie, sans changer de volume
  float g = pow(max(${i.gsplat}.scales.x * ${i.gsplat}.scales.y * ${i.gsplat}.scales.z, 1e-30), 1.0 / 3.0);
  ${o.gsplat}.scales = mix(${o.gsplat}.scales, vec3(g * z / z0), ${i.rnd}) * ${i.size};
  // au fond du scroll : taille plafonnée (≈ 1,6 pixel de la photo) -> plein de petites cellules nettes au lieu du flou
  float cap = mix(1000.0, 2.2 * z / 1288.0, ${i.prog});
  ${o.gsplat}.scales = min(${o.gsplat}.scales, vec3(cap));
  float ph = fi * 0.3;
  ${o.gsplat}.center.x += sin(${i.time} + ph) * ${i.move} * z;
  ${o.gsplat}.center.y += cos(${i.time} + ph * 1.3) * ${i.move} * z;
  // Changement de photo, sur place : apparition du centre vers les bords (chaque cellule grandit à sa
  // position) ; la disparition est la même animation jouée à l'envers (des bords vers le centre).
  // même effet qu'avant (ellipse du cadre, montée douce) ; hasard réduit à 8 % pour que les bords ne devancent plus le centre
  float r = clamp(length(vec2(${o.gsplat}.center.x / z / 0.59, ${o.gsplat}.center.y / z / 0.30)) / 1.42, 0.0, 1.0);
  float stag = r * 0.92 + h * 0.08;
  float d = 1.0 - clamp((${i.fade} - stag * 0.6) / 0.4, 0.0, 1.0);
  if (d > 0.0) {
    ${o.gsplat}.scales = mix(${o.gsplat}.scales, vec3(0.0006 * z), smoothstep(0.0, 0.5, d)) * (1.0 - 0.7 * d);
    ${o.gsplat}.rgba.a *= 1.0 - smoothstep(0.3, 1.0, d);
  }
  // Cadre net : tout ce qui sort du rectangle de la photo (vu depuis le point de vue SHARP) est coupé,
  // après le mouvement ; les bords restent des lignes droites même quand on avance dans la scène.
  // Cellules selon la proximité de la caméra (là où les gaussiennes deviennent grandes et floues à l'écran)
  // combinées à l'avancement du parcours ; la base SHARP s'efface d'autant
  float nr = clamp(1.0 - (${o.gsplat}.center.z - ${i.camz}) / 0.7, 0.0, 1.0);
  float cw = max(${i.cellr}, nr * nr * (3.0 - 2.0 * nr));
  ${o.gsplat}.rgba.a *= (${i.solid} > 0.5) ? cw : (1.0 - 0.85 * cw);
  // Couleurs : la page sort en linéaire (rendu r128 des points), et Spark applique alors srgbToLinear
  // (pow 2,2) à chaque gaussienne ; on compense pour retrouver exactement les couleurs de la photo.
  ${o.gsplat}.rgba.rgb = pow(max(${o.gsplat}.rgba.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  vec2 uv = ${o.gsplat}.center.xy / max(${o.gsplat}.center.z, 0.05);
  if (abs(uv.x) > 0.587 || abs(uv.y) > 0.300) ${o.gsplat}.rgba.a = 0.0;
`.split("\n").map((l) => l.trim()).filter(Boolean);

function makeLayer(url, isMol) {
  const u = { fade: dyno.dynoFloat(1), move: dyno.dynoFloat(0), size: dyno.dynoFloat(1), inn: dyno.dynoFloat(0), solid: dyno.dynoFloat(isMol ? 1 : 0) };
  const mesh = new SplatMesh({ url });
  mesh.quaternion.set(1, 0, 0, 0);            // OpenCV -> three.js (y et z retournés)
  mesh.position.set(0, 0, D);
  mesh.scale.setScalar(D);
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const block = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: "float", time: "float", move: "float", size: "float", fade: "float", rnd: "float", gam: "float", prog: "float", inn: "float", solid: "float", camz: "float", cellr: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, t: shared.t, time: shared.time, move: u.move, size: u.size, fade: u.fade, rnd: shared.round, gam: shared.gamma, prog: shared.prog, inn: u.inn, solid: u.solid, camz: shared.camZ, cellr: shared.cellR },
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
export const TRANSITION = { wait: 600, out: 800, black: 250, in: 800 }; // millisecondes

// Grille de profondeur (GW x GH) vue depuis le point de vue SHARP : pour chaque case, la profondeur de la
// matière visible (25e centile des gaussiennes qui s'y projettent = surface la plus proche), lissée.
export const GW = 96, GH = 49, HALF_U = 0.587, HALF_V = 0.3003;
function depthGridFrom(ps) {
  const n = ps.numSplats, cells = Array.from({ length: GW * GH }, () => []), all = [];
  for (let k = 0; k < n; k += 9) {
    const u = unpackSplat(ps.packedArray, k, ps.splatEncoding);
    if (u.opacity < 0.3 || u.center.z < 0.05) continue;
    const gx = Math.round(((u.center.x / u.center.z) / HALF_U * 0.5 + 0.5) * (GW - 1));
    const gy = Math.round(((u.center.y / u.center.z) / HALF_V * 0.5 + 0.5) * (GH - 1));
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    cells[gy * GW + gx].push(u.center.z); all.push(u.center.z);
  }
  all.sort((a, b) => a - b);
  const median = all.length ? all[all.length >> 1] : 1;
  let z = new Float32Array(GW * GH).fill(NaN);
  cells.forEach((c, i) => { if (c.length) { c.sort((a, b) => a - b); z[i] = c[Math.floor(c.length * 0.25)]; } });
  for (let pass = 0; pass < 20; pass++) {        // cases vides : moyenne des voisines
    let empty = 0; const nz = z.slice();
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x; if (!isNaN(z[i])) continue; let sum = 0, c = 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < GW && yy >= 0 && yy < GH && !isNaN(z[yy * GW + xx])) { sum += z[yy * GW + xx]; c++; } }
      if (c) nz[i] = sum / c; else empty++;
    }
    z = nz; if (!empty) break;
  }
  for (let i = 0; i < z.length; i++) if (isNaN(z[i])) z[i] = median;
  const sm = new Float32Array(z.length);           // lissage 3 x 3 (évite les déchirures)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let sum = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < GW && yy >= 0 && yy < GH) { sum += z[yy * GW + xx]; c++; } }
    sm[y * GW + x] = sum / c;
  }
  sm.median = median;
  return sm;
}

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
    this.cellW = 0;
    this.photoW = 0;
    this.phase = 'idle';
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
      // Carte de profondeur tirée de SHARP (pour plier la photo 2D) + profondeur médiane
      s.base.mesh.initialized.then((m) => { s.depthGrid = depthGridFrom(m.packedSplats); s.zMedian = s.depthGrid.median; });
    }
    return s;
  }

  isReady(i) { const s = this.scenes.get(i); return !!(s && s.base.mesh.isInitialized && s.mol.mesh.isInitialized); }

  // Une transition est en cours (le scroll doit attendre)
  busy() { return this.next != null; }

  // Profondeur (après compression) du plan où poser la photo 2D : 1 = plan proche
  // Jusqu'où la caméra peut avancer (repère des fichiers, 0 = point de vue SHARP) sans entrer dans la matière :
  // matière la plus proche dans la zone centrale de l'image (là où la caméra avance), moins une marge.
  cameraLimit(i, max = 1.6, margin = 0.2) {
    const g = this.depthGrid(i);
    if (!g) return max;
    let zmin = Infinity;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const u = -HALF_U + 2 * HALF_U * x / (GW - 1), v = -HALF_V + 2 * HALF_V * y / (GH - 1);
      const zc = Math.pow(Math.max(g[y * GW + x], 0.05), sharp.depthGamma);
      // seule la matière sur le trajet de la caméra compte : distance à l'axe (à sa profondeur) < 0,16 (≈ 4 unités)
      if (Math.hypot(u, v) * zc > 0.16) continue;
      zmin = Math.min(zmin, zc);
    }
    return Math.max(0.2, Math.min(max, zmin - margin));
  }
  depthGrid(i) { const s = this.scenes.get(i); return s && s.depthGrid ? s.depthGrid : null; }
  photoDepth(i) { const s = this.scenes.get(i); return s && s.zMedian ? Math.pow(Math.max(1, s.zMedian), sharp.depthGamma) : 1; }

  // Image affichée tout de suite (chargement, flèches, retour aux gaussiennes)
  show(i) { this.current = i; this.next = null; this.fadeCur = 1; this.fadeNext = 0; this._keep(); this._apply(); }

  // Lancer le changement de photo (automatique, chronométré)
  startTransition(i) {
    if (i === this.current || this.next != null) return;
    this.next = i; this._keep(); this.t0 = performance.now();
  }

  setVisible(v) { this.visible = v; this._keep(); this._apply(); }

  // Mémoire : seulement la photo affichée et la suivante (environ 2,3 millions de gaussiennes chacune)
  _keep() {
    if (!this.visible || this.current == null) return;
    const keep = new Set([this.current, this.next ?? (this.current % this.count) + 1]);
    for (const i of keep) this._get(i);
    for (const [i, s] of this.scenes) if (!keep.has(i)) {
      for (const l of [s.base, s.mol]) { this.parent.remove(l.mesh); l.mesh.dispose(); }
      this.scenes.delete(i);
    }
  }

  _apply() {
    for (const [i, s] of this.scenes) {
      const fade = i === this.current ? this.fadeCur : i === this.next ? this.fadeNext : 0;
      for (const layer of [s.base, s.mol]) {
        // le mélange SHARP lisse / cellules est fait par gaussienne (parcours + proximité caméra) dans le modificateur
        const op = 1 - this.photoW;
        const molNeeded = this.cellW > 0.001 || this.camObj > 0.25;
        const on = this.visible && fade > 0 && op > 0.001 && (!layer.isMol || (sharp.showMol && molNeeded));
        layer.mesh.opacity = op;
        layer.mesh.visible = on;
        layer.u.fade.value = fade;
        layer.u.inn.value = i === this.next ? 1 : 0;   // photo qui apparaît
      }
    }
  }

  // Avance la transition selon le temps (pas le scroll)
  _tick() {
    if (this.next == null) { this.phase = 'idle'; return; }
    const T = TRANSITION, e = performance.now() - this.t0;
    this.phase = e < T.wait ? 'wait' : 'run';
    const ready = this.isReady(this.next);
    if (e < T.wait) { this.fadeCur = 1; this.fadeNext = 0; }
    else if (e < T.wait + T.out) { this.fadeCur = 1 - (e - T.wait) / T.out; this.fadeNext = 0; }
    else if (e < T.wait + T.out + T.black || !ready) { this.fadeCur = 0; this.fadeNext = 0; }   // noir (et on attend la scène si besoin)
    else if (e < T.wait + T.out + T.black + T.in) { this.fadeCur = 0; this.fadeNext = (e - T.wait - T.out - T.black) / T.in; }
    else { this.current = this.next; this.next = null; this.fadeCur = 1; this.fadeNext = 0; this._keep(); }
  }

  // À chaque image. disparity : 0..7 (états du parcours)
  // Renvoie true si quelque chose a changé (à redessiner)
  update({ disparity, movement, time, photo = 0, cameraZ = 25 }) {
    if (!this.visible) return false;
    let changed = this.busy();
    this.photoW = photo;
    this.camObj = (D - cameraZ) / D;          // caméra dans le repère des fichiers (0 = point de vue SHARP)
    shared.camZ.value = this.camObj;
    shared.t.value = Math.min(1, Math.max(0, disparity / 7)) * sharp.reliefMul;
    shared.time.value = time;
    const x = Math.min(1, Math.max(0, (disparity / 7 - sharp.cellFrom) / (sharp.cellTo - sharp.cellFrom)));
    this.cellW = x * x;       // progressif
    shared.cellR.value = this.cellW;
    this._tick();
    this._apply();
    const p = Math.pow(Math.min(1, Math.max(0, disparity / 7)), sharp.curve); // 0 au départ, 1 au fond
    shared.round.value = sharp.roundness * p;
    shared.prog.value = p;
    sharp.progress = p;
    shared.gamma.value = sharp.depthGamma;
    for (const [, s] of this.scenes) {
      s.base.u.move.value = (Math.pow(Math.min(1, movement / 0.5), sharp.curve) * 0.5 * 2 * sharp.moveMul) / D;
      s.mol.u.move.value = (movement * 2 * sharp.cellMove) / D;   // cellules : ton mouvement, à l'identique
      s.mol.u.size.value = sharp.molSize;
    }
    const common = [shared.camZ.value.toFixed(3), shared.cellR.value.toFixed(3), shared.round.value.toFixed(3), sharp.depthGamma, this.fadeCur.toFixed(3), this.fadeNext.toFixed(3), sharp.molSize].join("|");
    for (const [, s] of this.scenes) for (const l of [s.base, s.mol]) {
      if (!l.mesh.visible || !l.mesh.isInitialized) continue;
      const key = common + "|" + (l.u.move.value > 0 ? time.toFixed(4) : "0");   // le temps ne compte que si la couche bouge
      if (key !== l.lastKey) { l.lastKey = key; l.mesh.updateVersion(); changed = true; }
    }
    const vis = [...this.scenes.values()].map((s) => +s.base.mesh.visible + 2 * s.mol.mesh.visible + (s.base.mesh.isInitialized ? 4 : 0)).join('');
    if (vis !== this.lastVis) { this.lastVis = vis; changed = true; }
    return changed;
  }
}
