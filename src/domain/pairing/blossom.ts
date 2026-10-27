/**
 * Gewichtetes Maximum-Matching in allgemeinen Graphen (Edmonds' Blossom-Algorithmus
 * mit primal-dualer Gewichtsbehandlung), Laufzeit O(n³).
 *
 * Portierung der bewährten Referenzimplementierung `mwmatching.py` von
 * Joris van Rantwijk (Public Domain), die auf Galil, "Efficient algorithms for
 * finding maximum matching in graphs" (ACM Computing Surveys, 1986) beruht.
 * Die Struktur und die Variablennamen folgen bewusst dem Original, damit die
 * Portierung Zeile für Zeile nachprüfbar bleibt. Die Korrektheit wird zusätzlich
 * in den Tests gegen ein exaktes Bitmasken-DP geprüft.
 *
 * Bei ganzzahligen Gewichten rechnet der Algorithmus exakt.
 */

export interface WeightedEdge {
  i: number;
  j: number;
  weight: number;
}

/**
 * Liefert `mate[v]` = Partner von v oder -1.
 * Mit `maxCardinality = true` wird unter allen Matchings maximaler Kardinalität
 * dasjenige mit maximalem Gewicht gesucht.
 */
export function maxWeightMatching(
  vertexCount: number,
  edges: readonly WeightedEdge[],
  maxCardinality: boolean,
): number[] {
  const nedge = edges.length;
  const nvertex = vertexCount;
  if (nedge === 0 || nvertex === 0) return new Array<number>(nvertex).fill(-1);

  const ei = new Int32Array(nedge);
  const ej = new Int32Array(nedge);
  const ew = new Float64Array(nedge);
  let maxweight = 0;
  for (let k = 0; k < nedge; k++) {
    const e = edges[k]!;
    if (e.i === e.j || e.i < 0 || e.j < 0 || e.i >= nvertex || e.j >= nvertex) {
      throw new Error(`Ungültige Kante ${e.i}-${e.j}`);
    }
    ei[k] = e.i;
    ej[k] = e.j;
    ew[k] = e.weight;
    if (e.weight > maxweight) maxweight = e.weight;
  }

  // endpoint[p] ist der Knoten am Kantenende p; Kante k hat die Enden 2k und 2k+1.
  const endpoint = new Int32Array(2 * nedge);
  for (let k = 0; k < nedge; k++) {
    endpoint[2 * k] = ei[k]!;
    endpoint[2 * k + 1] = ej[k]!;
  }
  const neighbend: number[][] = Array.from({ length: nvertex }, () => []);
  for (let k = 0; k < nedge; k++) {
    neighbend[ei[k]!]!.push(2 * k + 1);
    neighbend[ej[k]!]!.push(2 * k);
  }

  const mate = new Array<number>(nvertex).fill(-1);
  const label = new Array<number>(2 * nvertex).fill(0);
  const labelend = new Array<number>(2 * nvertex).fill(-1);
  const inblossom = Array.from({ length: nvertex }, (_, v) => v);
  const blossomparent = new Array<number>(2 * nvertex).fill(-1);
  const blossomchilds: Array<number[] | null> = new Array(2 * nvertex).fill(null);
  const blossombase = new Array<number>(2 * nvertex).fill(-1);
  for (let v = 0; v < nvertex; v++) blossombase[v] = v;
  const blossomendps: Array<number[] | null> = new Array(2 * nvertex).fill(null);
  const bestedge = new Array<number>(2 * nvertex).fill(-1);
  const blossombestedges: Array<number[] | null> = new Array(2 * nvertex).fill(null);
  const unusedblossoms: number[] = [];
  for (let b = nvertex; b < 2 * nvertex; b++) unusedblossoms.push(b);
  const dualvar = new Array<number>(2 * nvertex).fill(0);
  for (let v = 0; v < nvertex; v++) dualvar[v] = maxweight;
  const allowedge = new Array<boolean>(nedge).fill(false);
  let queue: number[] = [];

  const slack = (k: number): number => dualvar[ei[k]!]! + dualvar[ej[k]!]! - 2 * ew[k]!;

  const blossomLeaves = (b: number, out: number[] = []): number[] => {
    if (b < nvertex) {
      out.push(b);
    } else {
      for (const t of blossomchilds[b]!) {
        if (t < nvertex) out.push(t);
        else blossomLeaves(t, out);
      }
    }
    return out;
  };

  const assignLabel = (w: number, t: number, p: number): void => {
    const b = inblossom[w]!;
    label[w] = label[b] = t;
    labelend[w] = labelend[b] = p;
    bestedge[w] = bestedge[b] = -1;
    if (t === 1) {
      queue.push(...blossomLeaves(b));
    } else if (t === 2) {
      const base = blossombase[b]!;
      assignLabel(endpoint[mate[base]!]!, 1, mate[base]! ^ 1);
    }
  };

  const scanBlossom = (vIn: number, wIn: number): number => {
    let v = vIn;
    let w = wIn;
    const path: number[] = [];
    let base = -1;
    while (v !== -1 || w !== -1) {
      let b = inblossom[v]!;
      if (label[b]! & 4) {
        base = blossombase[b]!;
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelend[b]! === -1) {
        v = -1;
      } else {
        v = endpoint[labelend[b]!]!;
        b = inblossom[v]!;
        v = endpoint[labelend[b]!]!;
      }
      if (w !== -1) {
        const tmp = v;
        v = w;
        w = tmp;
      }
    }
    for (const b of path) label[b] = 1;
    return base;
  };

  const addBlossom = (base: number, k: number): void => {
    let v = ei[k]!;
    let w = ej[k]!;
    const bb = inblossom[base]!;
    let bv = inblossom[v]!;
    let bw = inblossom[w]!;
    const b = unusedblossoms.pop()!;
    blossombase[b] = base;
    blossomparent[b] = -1;
    blossomparent[bb] = b;
    const path: number[] = [];
    const endps: number[] = [];
    blossomchilds[b] = path;
    blossomendps[b] = endps;
    while (bv !== bb) {
      blossomparent[bv] = b;
      path.push(bv);
      endps.push(labelend[bv]!);
      v = endpoint[labelend[bv]!]!;
      bv = inblossom[v]!;
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomparent[bw] = b;
      path.push(bw);
      endps.push(labelend[bw]! ^ 1);
      w = endpoint[labelend[bw]!]!;
      bw = inblossom[w]!;
    }
    label[b] = 1;
    labelend[b] = labelend[bb]!;
    dualvar[b] = 0;
    for (const leaf of blossomLeaves(b)) {
      if (label[inblossom[leaf]!]! === 2) queue.push(leaf);
      inblossom[leaf] = b;
    }
    const bestedgeto = new Array<number>(2 * nvertex).fill(-1);
    for (const sub of path) {
      let nblists: number[][];
      if (blossombestedges[sub]! === null) {
        nblists = blossomLeaves(sub).map((leaf) => neighbend[leaf]!.map((p) => p >> 1));
      } else {
        nblists = [blossombestedges[sub]!];
      }
      for (const nblist of nblists) {
        for (const kk of nblist) {
          // j = das Kantenende außerhalb der neuen Blüte
          const j = inblossom[ej[kk]!]! === b ? ei[kk]! : ej[kk]!;
          const bj = inblossom[j]!;
          if (
            bj !== b &&
            label[bj]! === 1 &&
            (bestedgeto[bj]! === -1 || slack(kk) < slack(bestedgeto[bj]!))
          ) {
            bestedgeto[bj] = kk;
          }
        }
      }
      blossombestedges[sub] = null;
      bestedge[sub] = -1;
    }
    const best = bestedgeto.filter((kk) => kk !== -1);
    blossombestedges[b] = best;
    bestedge[b] = -1;
    for (const kk of best) {
      if (bestedge[b]! === -1 || slack(kk) < slack(bestedge[b]!)) bestedge[b] = kk;
    }
  };

  const expandBlossom = (b: number, endstage: boolean): void => {
    for (const s of blossomchilds[b]!) {
      blossomparent[s] = -1;
      if (s < nvertex) {
        inblossom[s] = s;
      } else if (endstage && dualvar[s]! === 0) {
        expandBlossom(s, endstage);
      } else {
        for (const leaf of blossomLeaves(s)) inblossom[leaf] = s;
      }
    }
    if (!endstage && label[b]! === 2) {
      const childs = blossomchilds[b]!;
      const endps = blossomendps[b]!;
      const len = childs.length;
      const at = (idx: number) => ((idx % len) + len) % len;
      const entrychild = inblossom[endpoint[labelend[b]! ^ 1]!]!;
      let j = childs.indexOf(entrychild);
      let jstep: number;
      let endptrick: number;
      if (j & 1) {
        j -= len;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let p = labelend[b]!;
      while (j !== 0) {
        label[endpoint[p ^ 1]!] = 0;
        label[endpoint[endps[at(j - endptrick)]! ^ endptrick ^ 1]!] = 0;
        assignLabel(endpoint[p ^ 1]!, 2, p);
        allowedge[endps[at(j - endptrick)]! >> 1] = true;
        j += jstep;
        p = endps[at(j - endptrick)]! ^ endptrick;
        allowedge[p >> 1] = true;
        j += jstep;
      }
      let bv = childs[at(j)]!;
      label[endpoint[p ^ 1]!] = label[bv] = 2;
      labelend[endpoint[p ^ 1]!] = labelend[bv] = p;
      bestedge[bv] = -1;
      j += jstep;
      while (childs[at(j)]! !== entrychild) {
        bv = childs[at(j)]!;
        if (label[bv]! === 1) {
          j += jstep;
          continue;
        }
        let found = -1;
        for (const leaf of blossomLeaves(bv)) {
          if (label[leaf]! !== 0) {
            found = leaf;
            break;
          }
        }
        if (found !== -1) {
          label[found] = 0;
          label[endpoint[mate[blossombase[bv]!]!]!] = 0;
          assignLabel(found, 2, labelend[found]!);
        }
        j += jstep;
      }
    }
    label[b] = labelend[b] = -1;
    blossomchilds[b] = blossomendps[b] = null;
    blossombase[b] = -1;
    blossombestedges[b] = null;
    bestedge[b] = -1;
    unusedblossoms.push(b);
  };

  const augmentBlossom = (b: number, v: number): void => {
    let t = v;
    while (blossomparent[t]! !== b) t = blossomparent[t]!;
    if (t >= nvertex) augmentBlossom(t, v);
    const childs = blossomchilds[b]!;
    const endps = blossomendps[b]!;
    const len = childs.length;
    const at = (idx: number) => ((idx % len) + len) % len;
    const i = childs.indexOf(t);
    let j = i;
    let jstep: number;
    let endptrick: number;
    if (i & 1) {
      j -= len;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (j !== 0) {
      j += jstep;
      t = childs[at(j)]!;
      const p = endps[at(j - endptrick)]! ^ endptrick;
      if (t >= nvertex) augmentBlossom(t, endpoint[p]!);
      j += jstep;
      t = childs[at(j)]!;
      if (t >= nvertex) augmentBlossom(t, endpoint[p ^ 1]!);
      mate[endpoint[p]!] = p ^ 1;
      mate[endpoint[p ^ 1]!] = p;
    }
    blossomchilds[b] = childs.slice(i).concat(childs.slice(0, i));
    blossomendps[b] = endps.slice(i).concat(endps.slice(0, i));
    blossombase[b] = blossombase[blossomchilds[b]![0]!]!;
  };

  const augmentMatching = (k: number): void => {
    const pairs: Array<[number, number]> = [
      [ei[k]!, 2 * k + 1],
      [ej[k]!, 2 * k],
    ];
    for (const [sStart, pStart] of pairs) {
      let s = sStart;
      let p = pStart;
      for (;;) {
        const bs = inblossom[s]!;
        if (bs >= nvertex) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelend[bs]! === -1) break;
        const t = endpoint[labelend[bs]!]!;
        const bt = inblossom[t]!;
        s = endpoint[labelend[bt]!]!;
        const j = endpoint[labelend[bt]! ^ 1]!;
        if (bt >= nvertex) augmentBlossom(bt, j);
        mate[j] = labelend[bt]!;
        p = labelend[bt]! ^ 1;
      }
    }
  };

  for (let stage = 0; stage < nvertex; stage++) {
    label.fill(0);
    bestedge.fill(-1);
    for (let b = nvertex; b < 2 * nvertex; b++) blossombestedges[b] = null;
    allowedge.fill(false);
    queue = [];
    for (let v = 0; v < nvertex; v++) {
      if (mate[v]! === -1 && label[inblossom[v]!]! === 0) assignLabel(v, 1, -1);
    }
    let augmented = false;
    for (;;) {
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighbend[v]!) {
          const k = p >> 1;
          const w = endpoint[p]!;
          if (inblossom[v]! === inblossom[w]!) continue;
          let kslack = 0;
          if (!allowedge[k]!) {
            kslack = slack(k);
            if (kslack <= 0) allowedge[k] = true;
          }
          if (allowedge[k]!) {
            if (label[inblossom[w]!]! === 0) {
              assignLabel(w, 2, p ^ 1);
            } else if (label[inblossom[w]!]! === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) {
                addBlossom(base, k);
              } else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w]! === 0) {
              label[w] = 2;
              labelend[w] = p ^ 1;
            }
          } else if (label[inblossom[w]!]! === 1) {
            const b = inblossom[v]!;
            if (bestedge[b]! === -1 || kslack < slack(bestedge[b]!)) bestedge[b] = k;
          } else if (label[w]! === 0) {
            if (bestedge[w]! === -1 || kslack < slack(bestedge[w]!)) bestedge[w] = k;
          }
        }
      }
      if (augmented) break;

      let deltatype = -1;
      let delta = 0;
      let deltaedge = -1;
      let deltablossom = -1;
      if (!maxCardinality) {
        deltatype = 1;
        delta = Infinity;
        for (let v = 0; v < nvertex; v++) delta = Math.min(delta, dualvar[v]!);
      }
      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]!]! === 0 && bestedge[v]! !== -1) {
          const d = slack(bestedge[v]!);
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge[v]!;
          }
        }
      }
      for (let b = 0; b < 2 * nvertex; b++) {
        if (blossomparent[b]! === -1 && label[b]! === 1 && bestedge[b]! !== -1) {
          const d = slack(bestedge[b]!) / 2;
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge[b]!;
          }
        }
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (
          blossombase[b]! >= 0 &&
          blossomparent[b]! === -1 &&
          label[b]! === 2 &&
          (deltatype === -1 || dualvar[b]! < delta)
        ) {
          delta = dualvar[b]!;
          deltatype = 4;
          deltablossom = b;
        }
      }
      if (deltatype === -1) {
        // Kein weiterer Fortschritt möglich: optimales Matching maximaler Kardinalität.
        deltatype = 1;
        let minDual = Infinity;
        for (let v = 0; v < nvertex; v++) minDual = Math.min(minDual, dualvar[v]!);
        delta = Math.max(0, minDual);
      }

      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]!]! === 1) dualvar[v] = dualvar[v]! - delta;
        else if (label[inblossom[v]!]! === 2) dualvar[v] = dualvar[v]! + delta;
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (blossombase[b]! >= 0 && blossomparent[b]! === -1) {
          if (label[b]! === 1) dualvar[b] = dualvar[b]! + delta;
          else if (label[b]! === 2) dualvar[b] = dualvar[b]! - delta;
        }
      }

      if (deltatype === 1) {
        break;
      } else if (deltatype === 2) {
        allowedge[deltaedge] = true;
        let i = ei[deltaedge]!;
        if (label[inblossom[i]!]! === 0) i = ej[deltaedge]!;
        queue.push(i);
      } else if (deltatype === 3) {
        allowedge[deltaedge] = true;
        queue.push(ei[deltaedge]!);
      } else if (deltatype === 4) {
        expandBlossom(deltablossom, false);
      }
    }
    if (!augmented) break;

    for (let b = nvertex; b < 2 * nvertex; b++) {
      if (
        blossomparent[b]! === -1 &&
        blossombase[b]! >= 0 &&
        label[b]! === 1 &&
        dualvar[b]! === 0
      ) {
        expandBlossom(b, true);
      }
    }
  }

  for (let v = 0; v < nvertex; v++) {
    if (mate[v]! >= 0) mate[v] = endpoint[mate[v]!]!;
  }
  return mate;
}
