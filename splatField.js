// splatField.js : couche « Gaussian Splatting » procédurale pour Volume Photographique (gs.html).
// Chaque cellule d'une grille posée sur la photo devient une gaussienne 3D : position, profondeur,
// orientation et couleur viennent des mêmes données que les points (photo + carte de profondeur).
// Dépendances : three >= 0.180 et @sparkjsdev/spark 2.x (importmap).
// Doc Spark : https://sparkjs.dev/docs/procedural-splats/ et https://sparkjs.dev/docs/splat-mesh
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// Réglages R&D (reliés aux curseurs du panneau G)
export const gs = {
  step: 4,       // 1 gaussienne toutes les `step` pixels de l'image de travail (4 -> ~95 000 sur desktop)
  k: 0.6,        // TAILLE σ : sigma = k x pas de la grille
  flat: 0.2,     // épaisseur : sigma_z = flat x sigma (0.2 = disques, 1 = boules)
  relief: 1.0,   // RELIEF : multiplie la profondeur donnée par le scroll (états 1 à 7)
  jitter: 0.0,   // DISPERSION : z aléatoire (amplitude totale, unités monde)
  alpha: 1.0,    // opacité de chaque gaussienne
};

// À appeler une seule fois : le moteur de rendu des splats (obligatoire depuis Spark 2.0)
export function addSparkRenderer(scene, renderer) {
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  return spark;
}

// Échantillonne une image de travail (ImageData) en cellules.
// depthAt(x, y, lum) -> profondeur normalisée (≈ -0.5..0.5), comme normalizedDepth des points.
// colorAt(r, g, b, lum) -> [r, g, b] (0..1), comme la couleur des points.
// rand(x, y, seed) -> 0..1 déterministe (pour casser la trame de la grille).
export function buildCells({ imgData, scaleFactor, step, depthAt, colorAt, rand }) {
  const W = imgData.width, H = imgData.height, px = imgData.data;
  const gw = Math.floor(W / step), gh = Math.floor(H / step), n = gw * gh;
  const X = new Float32Array(n), Y = new Float32Array(n), D = new Float32Array(n);
  const COL = new Float32Array(n * 3), A = new Float32Array(n);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const i = cy * gw + cx;
      const x = cx * step + (step >> 1), y = cy * step + (step >> 1);
      const p = (y * W + x) * 4;
      const r = px[p] / 255, g = px[p + 1] / 255, b = px[p + 2] / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Même repère que les points après leur rotation.x = PI : l'axe Y monde monte
      const jx = rand ? (rand(x, y, 7) - 0.5) * 0.6 * step : 0;
      const jy = rand ? (rand(x, y, 8) - 0.5) * 0.6 * step : 0;
      X[i] = (x + jx - W / 2) / scaleFactor;
      Y[i] = -(y + jy - H / 2) / scaleFactor;
      D[i] = depthAt(x, y, lum);
      const c = colorAt(r, g, b, lum);
      COL[3 * i] = c[0]; COL[3 * i + 1] = c[1]; COL[3 * i + 2] = c[2];
      A[i] = px[p + 3] > 127 ? 1 : 0;
    }
  }
  return { gw, gh, n, X, Y, D, COL, A, cell: step / scaleFactor };
}

// Objets réutilisés : Spark recopie les valeurs, aucune allocation dans la boucle
const C = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();
const N = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), K = new THREE.Color();

// Une grille fixe de gaussiennes dont on réécrit les valeurs quand la profondeur ou l'image change.
export class SplatField {
  constructor(parent) {
    this.parent = parent;
    this.mesh = null;
    this.ready = false;
    this.a = null;      // cellules de l'image affichée
    this.b = null;      // cellules de l'image suivante (pendant une transition)
    this.D = null;      // profondeur mélangée (tampon)
    this.J = null;      // tirage aléatoire fixe par gaussienne (DISPERSION)
    this.visible = false;
    this.opacity = 1;
  }

  // (Re)crée le SplatMesh si la taille de grille change
  _ensureMesh(n) {
    if (this.mesh && this.mesh.packedSplats && this.n === n) return;
    if (this.mesh) { this.parent.remove(this.mesh); this.mesh.dispose(); }
    this.n = n;
    this.ready = false;
    this.D = new Float32Array(n);
    this.J = Float32Array.from({ length: n }, () => Math.random() - 0.5);
    const mesh = new SplatMesh({
      maxSplats: n,
      constructSplats: (splats) => {
        for (let i = 0; i < n; i++) splats.pushSplat(C.set(0, 0, 0), S.set(1e-4, 1e-4, 1e-4), Q.identity(), 0, K.setRGB(0, 0, 0));
      },
    });
    mesh.visible = this.visible;
    mesh.opacity = this.opacity;
    this.parent.add(mesh);
    this.mesh = mesh;
    mesh.initialized.then(() => { if (this.mesh === mesh) { this.ready = true; this.dirty = true; } });
  }

  // Image affichée (chargement, flèches, reconstruction des points)
  setImage(cells) {
    this.a = cells; this.b = null;
    this._ensureMesh(cells.n);
    this.dirty = true;
  }

  // Début de transition vers l'image suivante (même grille, donc même nombre de cellules)
  setNext(cells) { this.b = cells.n === this.a?.n ? cells : null; this.dirty = true; }

  // Fin de transition : l'image suivante devient l'image affichée
  commitNext() { if (this.b) { this.a = this.b; this.b = null; this.dirty = true; } }

  setVisible(v) { this.visible = v; if (this.mesh) this.mesh.visible = v; if (v) this.dirty = true; }
  setOpacity(o) { this.opacity = o; if (this.mesh) this.mesh.opacity = o; }

  // Réécrit toutes les gaussiennes. disparity = profondeur du scroll, mix = avancement de la transition (0..1)
  update(disparity, mix = 0) {
    if (!this.ready || !this.a || !this.visible) return false;
    const { a } = this, b = this.b || a, m = this.b ? mix : 0, n = a.n, gw = a.gw, gh = a.gh;
    const D = this.D, J = this.J;
    const disp = disparity * gs.relief;
    for (let i = 0; i < n; i++) D[i] = a.D[i] + (b.D[i] - a.D[i]) * m;

    const sigma = gs.k * a.cell, inv2 = 1 / (2 * a.cell);
    const packed = this.mesh.packedSplats;
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const i = cy * gw + cx;
        // Profondeur : même signe que les points (rotation.x = PI inverse z)
        C.set(a.X[i], a.Y[i], -D[i] * disp + J[i] * gs.jitter);
        // Orientation : normale de la surface de profondeur (différences centrées)
        const l = D[cy * gw + (cx > 0 ? cx - 1 : cx)], r = D[cy * gw + (cx < gw - 1 ? cx + 1 : cx)];
        const u = D[(cy > 0 ? cy - 1 : cy) * gw + cx], d = D[(cy < gh - 1 ? cy + 1 : cy) * gw + cx];
        const dzdx = -(r - l) * disp * inv2;      // z = -D * disp
        const dzdy = -(u - d) * disp * inv2;      // Y monde monte quand la ligne d'image diminue
        N.set(-dzdx, -dzdy, 1).normalize();
        Q.setFromUnitVectors(Z, N);
        S.set(sigma, sigma, sigma * gs.flat);
        const c = 3 * i;
        K.setRGB(
          a.COL[c] + (b.COL[c] - a.COL[c]) * m,
          a.COL[c + 1] + (b.COL[c + 1] - a.COL[c + 1]) * m,
          a.COL[c + 2] + (b.COL[c + 2] - a.COL[c + 2]) * m,
        );
        packed.setSplat(i, C, S, Q, gs.alpha * a.A[i], K);
      }
    }
    packed.needsUpdate = true; // ré-envoi au GPU (doc SplatMesh)
    this.dirty = false;
    return true;
  }
}
