// sharpField.js : affiche les scènes SHARP (Apple) préparées par ml-sharp/volume.py,
// dans le « médium » de Volume Photographique.
// - chaque fichier Ressources/sharp/IMG_00X_volume.spz forme le rectangle de la photo,
//   avec z = profondeur normalisée (-0.5 loin .. +0.5 proche)
// - sur la carte graphique (dyno de Spark), à chaque image :
//     z = profondeur x relief (la disparité du scroll : 0 = plat, 7 = sculpture)
//     x, y oscillent comme les points (mode 2 de index.html)
//     taille des sphères x densité
import { SplatMesh, dyno } from "@sparkjsdev/spark";

export const sharp = {
  reliefMul: 1.0,   // RELIEF : multiplie la disparité du scroll
  density: 1.4,     // DENSITÉ : taille des sphères (plus grand = moins transparent)
  moveMul: 1.0,     // MOUVEMENT : multiplie le mouvement du parcours
};

// Uniforms partagés par toutes les scènes (changent à chaque image sans recompiler)
const U = {
  relief: dyno.dynoFloat(0),
  time: dyno.dynoFloat(0),
  move: dyno.dynoFloat(0),
  size: dyno.dynoFloat(1),
};

const GLSL = (o, i) => `
  ${o.gsplat} = ${i.gsplat};
  float ph = float(${i.gsplat}.index) * 0.3;
  ${o.gsplat}.center.z = ${i.gsplat}.center.z * ${i.relief};
  ${o.gsplat}.center.x += sin(${i.time} + ph) * ${i.move} * 2.0;
  ${o.gsplat}.center.y += cos(${i.time} + ph * 1.3) * ${i.move} * 2.0;
  ${o.gsplat}.scales *= ${i.size};
`.split("\n").map((l) => l.trim()).filter(Boolean);

function makeModifier() {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const block = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, relief: "float", time: "float", move: "float", size: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, relief: U.relief, time: U.time, move: U.move, size: U.size },
      statements: ({ inputs, outputs }) => GLSL(outputs, inputs),
    });
    return { gsplat: block.outputs.gsplat };
  });
}

export class SharpScenes {
  constructor(parent, urlOf) {
    this.parent = parent;
    this.urlOf = urlOf;           // (index) => url du .spz
    this.meshes = new Map();      // index -> SplatMesh (chargé à la demande, puis gardé)
    this.current = null;          // index affiché
    this.previous = null;         // index qui s'efface pendant une transition
    this.visible = false;
    this.last = "";
  }

  _get(index) {
    let m = this.meshes.get(index);
    if (!m) {
      m = new SplatMesh({ url: this.urlOf(index) });
      m.objectModifier = makeModifier();
      m.updateGenerator();
      m.visible = false;
      this.parent.add(m);
      this.meshes.set(index, m);
    }
    return m;
  }

  preload(index) { if (index != null) this._get(index); }

  // Image affichée sans fondu (chargement, flèches)
  show(index) {
    this.current = index; this.previous = null;
    this._apply(1);
  }

  // Début de transition : l'ancienne image s'efface pendant que la nouvelle apparaît
  crossTo(index) {
    if (index === this.current) return;
    this.previous = this.current; this.current = index;
    this._apply(0);
  }

  setVisible(v) { this.visible = v; this._apply(this.previous != null ? this.mix ?? 0 : 1); }

  _apply(mix) {
    this.mix = mix;
    for (const [i, m] of this.meshes) {
      const on = this.visible && (i === this.current || i === this.previous);
      m.visible = on;
      if (on) m.opacity = i === this.current ? (this.previous != null ? mix : 1) : 1 - mix;
    }
    if (this.visible && this.current != null) this._get(this.current).visible = true;
  }

  // À chaque image : disparité du scroll, mouvement, temps, avancement de la transition (0..1)
  update({ disparity, movement, time, mix = 1 }) {
    if (!this.visible) return;
    U.relief.value = disparity * sharp.reliefMul;
    U.move.value = movement * sharp.moveMul;
    U.time.value = time;
    U.size.value = sharp.density;
    if (this.previous != null) {
      if (mix >= 1) { this.previous = null; }
      this._apply(mix);
    }
    const key = `${U.relief.value.toFixed(4)}|${U.move.value}|${U.time.value}|${U.size.value}`;
    if (key !== this.last) {          // ne régénérer que si quelque chose a changé
      this.last = key;
      for (const [i, m] of this.meshes) if (m.visible && m.isInitialized) m.updateVersion();
    }
  }

  isReady(index) { const m = this.meshes.get(index); return !!(m && m.isInitialized); }
}
