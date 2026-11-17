import { describe, expect, it } from "vitest";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  BaseConfigChangeRefusedError,
  deletePropertyFromConfig,
  loadBaseConfigText,
  rebaseBaseConfigText,
  renamePropertyInConfig,
  serializeBaseConfig,
} from "@plainva/ui";


// Finding B20 (0.9.0 defect list), third review: a random test with hidden
// view identities, independent of the building block's matching rules. Each
// view carries an id through the loaded config (B), the screen's change (A)
// and the file as another device left it (F); the oracle, written from the
// agreed rules, says which views the written file must hold. A refusal is
// always safe — but none where the file is unchanged, and none where the
// database holds one view on each side. A write that differs from the oracle
// is a failure, except the one named limit of the name rule: the file
// deleted a view and added another, which then takes the change.

const yaml = { parse: yamlParse, stringify: yamlStringify };

interface Failure { app: string; file: string; problems: string; singleView: boolean }

function runCases(startSeed: number, N: number, KAPP = 1, PUN = 0.2, PDUP = 0.3) {
  let seed = startSeed >>> 0;
  const failures: Failure[] = [];
  function rnd() { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  const ri = (n: number) => Math.floor(rnd() * n);
  const pick = <T,>(a: T[]): T => a[ri(a.length)];
  const shuffle = <T,>(a: T[]) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const isObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);
  const deq = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deq(x, b[i]));
    if (isObj(a) && isObj(b)) {
      const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
      return ka.length === kb.length && ka.every((k) => deq(a[k], b[k]));
    }
    return false;
  };
  // canonical text: keys sorted; lists of distinct entries sorted (order checked separately)
  const ek = (e: any): string | null => typeof e === "string" ? `s:${e}` : typeof e === "number" ? `n:${e}` : isObj(e) && (typeof e.value === "string") ? `o:${e.value}` : null;
  const distinct = (l: any[]) => { const k = l.map(ek); return k.every((x) => x !== null) && new Set(k).size === k.length ? (k as string[]) : null; };
  const FALLBACK = /^(Table|Gallery|List|Board|Calendar|Timeline|Cards|Graph|Pinboard)( \d+)?$/;
  const canonView = (v: any) => (isObj(v) && typeof v.name === "string" && FALLBACK.test(v.name) ? (({ name: _n, ...r }) => r)(v) : v);
  const canon = (v: any): string => {
    if (Array.isArray(v)) { const items = v.map(canon); return `[${distinct(v) ? items.sort().join(",") : items.join(",")}]`; }
    if (isObj(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${k}:${canon(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
  };
  const PROPS = ["a", "b", "c", "d", "e"];
  let fresh = 0;
  const NAMES = ["T", "U", "W"];

  function genRaw(): any {
    const raw: any = {};
    if (rnd() < 0.5) raw.formulas = { f1: "a + 1" };
    if (rnd() < 0.7) {
      raw.properties = {};
      for (const p of PROPS) if (rnd() < 0.4) raw.properties[`note.${p}`] = rnd() < 0.4 ? { displayName: `D${p}` } : { plainva: { input: "select", options: shuffle(["x", "y", "z"]).filter(() => rnd() < 0.7).map((value) => ({ value })) } };
    }
    if (rnd() < 0.3) raw.zz = "top";
    const nv = 1 + ri(4);
    raw.views = [];
    for (let i = 0; i < nv; i++) {
      const v: any = { type: pick(["table", "cards", "list"]), name: rnd() < PDUP ? pick(NAMES) : `V${i}` };
      if (rnd() < 0.6) v.order = shuffle(PROPS).filter(() => rnd() < 0.5).map((p) => `note.${p}`);
      if (rnd() < 0.3) v.sort = [{ property: `note.${pick(PROPS)}`, direction: pick(["ASC", "DESC"]) }];
      if (rnd() < 0.3) v.limit = 1 + ri(3);
      if (rnd() < 0.2) v.xx = "unknown";
      if (rnd() < 0.2) v.plainva = { pinboardOrder: shuffle(["p1.md", "p2.md", "p3.md"]).filter(() => rnd() < 0.7) };
      if (rnd() < 0.25) v.plainva = { ...(v.plainva ?? {}), coverImage: pick(PROPS) };
      if (rnd() < 0.3) { v.summaries = {}; for (const p of PROPS) if (rnd() < 0.3) v.summaries[`note.${p}`] = pick(["Sum", "Average"]); }
      if (rnd() < 0.35) v.filters = { and: PROPS.filter(() => rnd() < 0.3).map((p) => `note.${p} == "1"`) };
      raw.views.push(v);
    }
    return raw;
  }

  function appMutate(shown: any, ids: number[]): { next: any; ids: number[]; ops: string[]; renamed: Set<number> } {
    const json = rnd() < 0.5;
    let next: any = json ? JSON.parse(JSON.stringify(shown)) : { ...shown, views: shown.views.slice() };
    const nids = ids.slice();
    const ops: string[] = [];
    const renamed = new Set<number>();
    const editView = (i: number, f: (v: any) => void) => { const v = json ? next.views[i] : { ...next.views[i] }; f(v); next.views[i] = v; };
    for (let s = 0; s < 1 + ri(KAPP); s++) {
      const nv = next.views.length;
      const r = ri(17);
      if (r === 13) { const i = ri(nv); editView(i, (v) => { delete v.coverImage; }); ops.push(`A.uncover[${nids[i]}]`); }
      else if (r === 14) { const i = ri(nv); editView(i, (v) => { const s = { ...(v.summaries ?? {}) }; const ks = Object.keys(s); if (ks.length && rnd() < 0.7) delete s[pick(ks)]; else s[pick(PROPS)] = "Max"; v.summaries = s; }); ops.push(`A.summary[${nids[i]}]`); }
      else if (r === 15) { const i = ri(nv); editView(i, (v) => { const and: string[] = (v.filters?.and ?? []).slice(); const q = ri(3); if (q === 0 && and.length) and.splice(ri(and.length), 1); else if (q === 1 && and.length) and[ri(and.length)] = `note.${pick(PROPS)} == "app"`; else and.push(`note.${pick(PROPS)} > ${ri(9)}`); v.filters = { and, or: [] }; }); ops.push(`A.filter[${nids[i]}]`); }
      else if (r === 16) { const i = ri(nv); editView(i, (v) => { delete v.filters; }); ops.push(`A.unfilter[${nids[i]}]`); }
      else if (r === 0) { const i = ri(nv); editView(i, (v) => { const cur: string[] = v.order ?? []; const pool = PROPS.filter((p) => !cur.includes(p)); const o = cur.slice(); const q = ri(3); if (q === 0 && pool.length) o.splice(ri(o.length + 1), 0, pick(pool)); else if (q === 1 && o.length) o.splice(ri(o.length), 1); else if (o.length > 1) { const a = ri(o.length), b = ri(o.length); [o[a], o[b]] = [o[b], o[a]]; } else o.push(pick(PROPS)); v.order = o; }); ops.push(`A.order[${nids[i]}]`); }
      else if (r === 1) { const i = ri(nv); editView(i, (v) => { v.sort = [{ property: pick(PROPS), direction: pick(["ASC", "DESC"]) }]; }); ops.push(`A.sort[${nids[i]}]`); }
      else if (r === 2) { const i = ri(nv); const nm = rnd() < 0.4 ? pick(NAMES) : `R${++fresh}`; editView(i, (v) => { v.name = nm; }); renamed.add(nids[i]); ops.push(`A.rename[${nids[i]}->${nm}]`); }
      else if (r === 3 && nv > 1) { const i = ri(nv); next.views.splice(i, 1); ops.push(`A.delete[${nids[i]}]`); nids.splice(i, 1); }
      else if (r === 4) { const id = 1000 + ++fresh; next.views.push({ type: "table", name: rnd() < 0.5 ? pick(NAMES) : `N${id}` }); nids.push(id); ops.push(`A.add[${id}]`); }
      else if (r === 5 && nv > 1) { const i = ri(nv - 1); [next.views[i], next.views[i + 1]] = [next.views[i + 1], next.views[i]]; [nids[i], nids[i + 1]] = [nids[i + 1], nids[i]]; ops.push(`A.move`); }
      else if (r === 6) { const i = ri(nv); editView(i, (v) => { v.coverImage = pick(PROPS); }); ops.push(`A.cover[${nids[i]}]`); }
      else if (r === 7) { const i = ri(nv); const id = 1000 + ++fresh; const cp = JSON.parse(JSON.stringify(next.views[i])); cp.name = rnd() < 0.5 ? `${cp.name ?? "Table"} Kopie` : (cp.name ?? undefined); next.views.splice(i + 1, 0, cp); nids.splice(i + 1, 0, id); ops.push(`A.duplicate[${nids[i]}->${id}]`); }
      else if (r === 8) { const i = ri(nv); editView(i, (v) => { const cur: string[] = v.pinboardOrder ?? []; const o = cur.slice(); if (o.length && rnd() < 0.5) o.splice(ri(o.length), 1); else o.splice(ri(o.length + 1), 0, `q${++fresh}.md`); v.pinboardOrder = o; }); ops.push(`A.pin[${nids[i]}]`); }
      else if (r === 9) { const p = pick(PROPS); next = json ? next : { ...next }; const col = { ...(next.columns?.[p] ?? {}) }; const cur: any[] = Array.isArray(col.options) ? col.options.slice() : []; if (cur.length && rnd() < 0.5) cur.splice(ri(cur.length), 1); else cur.splice(ri(cur.length + 1), 0, { value: `w${++fresh}` }); col.input = "select"; col.options = cur; next.columns = { ...(next.columns ?? {}), [p]: col }; ops.push(`A.options[${p}]`); }
      else if (r === 10) { const p = pick(PROPS); const q = `${p}${++fresh}`; next = renamePropertyInConfig(next, p, q); ops.push(`A.renameProp[${p}]`); }
      else if (r === 11) { const p = pick(PROPS); next = deletePropertyFromConfig(next, p); ops.push(`A.deleteProp[${p}]`); }
      else if (r === 12) { const i = ri(nv); editView(i, (v) => { v.widths = { ...(v.widths ?? {}), [pick(PROPS)]: 100 + ri(50) }; }); ops.push(`A.width[${nids[i]}]`); }
    }
    return { next, ids: nids, ops, renamed };
  }

  function fileMutate(raw: any, ids: number[]): { raw: any; ids: number[]; ops: string[] } {
    const f = structuredClone(raw);
    const fids = ids.slice();
    const ops: string[] = [];
    for (let s = 0, k = ri(4); s < k; s++) {
      const nv = f.views.length;
      const r = ri(18);
      if (r === 14) { const i = ri(nv); f.views[i].summaries = { ...(f.views[i].summaries ?? {}), [`note.${pick(PROPS)}`]: "Median" }; ops.push(`F.summary[${fids[i]}]`); }
      else if (r === 15) { const i = ri(nv); const and: string[] = (f.views[i].filters?.and ?? []).slice(); if (and.length && rnd() < 0.5) and[ri(and.length)] = `note.${pick(PROPS)} == "file${++fresh}"`; else and.push(`note.${pick(PROPS)} < ${ri(9)}`); f.views[i].filters = { and }; ops.push(`F.filter[${fids[i]}]`); }
      else if (r === 16) { const i = ri(nv); f.views[i].plainva = { ...(f.views[i].plainva ?? {}), futureKey: `k${++fresh}` }; ops.push(`F.plainvaKey[${fids[i]}]`); }
      else if (r === 17) { const i = ri(nv); f.views[i].plainva = { ...(f.views[i].plainva ?? {}), widths: { ...(f.views[i].plainva?.widths ?? {}), [pick(PROPS)]: 90 } }; ops.push(`F.width[${fids[i]}]`); }
      else if (r === 0) { const i = ri(nv); f.views[i].limit = 10 + ri(90); ops.push(`F.limit[${fids[i]}]`); }
      else if (r === 1) { const i = ri(nv); f.views[i].order = [...(f.views[i].order ?? []), `note.q${++fresh}`]; ops.push(`F.orderAppend[${fids[i]}]`); }
      else if (r === 2) { const i = ri(nv); f.views[i].sort = [{ property: `note.${pick(PROPS)}`, direction: pick(["ASC", "DESC"]) }]; ops.push(`F.sort[${fids[i]}]`); }
      else if (r === 3) { const i = ri(nv); f.views[i].name = `S${++fresh}`; ops.push(`F.rename[${fids[i]}]`); }
      else if (r === 4 && nv > 1) { const i = ri(nv); f.views.splice(i, 1); ops.push(`F.delete[${fids[i]}]`); fids.splice(i, 1); }
      else if (r === 5) { const id = 2000 + ++fresh; f.views.push({ type: "table", name: rnd() < 0.5 ? pick(NAMES) : `M${id}`, limit: 3 }); fids.push(id); ops.push(`F.add[${id}]`); }
      else if (r === 6 && nv > 1) { const i = ri(nv - 1); [f.views[i], f.views[i + 1]] = [f.views[i + 1], f.views[i]]; [fids[i], fids[i + 1]] = [fids[i + 1], fids[i]]; ops.push(`F.move`); }
      else if (r === 7) { f.formulas = { ...(f.formulas ?? {}), [`g${++fresh}`]: "b * 2" }; ops.push(`F.formula`); }
      else if (r === 8) { const p = `note.${pick(PROPS)}`; f.properties = { ...(f.properties ?? {}) }; f.properties[p] = { ...(f.properties[p] ?? {}), displayName: `X${++fresh}` }; ops.push(`F.displayName[${p}]`); }
      else if (r === 9) { f.zz = `z${++fresh}`; ops.push(`F.zz`); }
      else if (r === 10) { const i = ri(nv); f.views[i].xx = `u${++fresh}`; ops.push(`F.viewUnknown[${fids[i]}]`); }
      else if (r === 11) { const i = ri(nv); const o = f.views[i].order ?? []; if (o.length) { f.views[i].order = o.filter((_: any, k: number) => k !== ri(o.length)); ops.push(`F.orderRemove[${fids[i]}]`); } }
      else if (r === 12) { const i = ri(nv); const pv = (f.views[i].plainva = { ...(f.views[i].plainva ?? {}) }); pv.pinboardOrder = [...(pv.pinboardOrder ?? []), `f${++fresh}.md`]; ops.push(`F.pin[${fids[i]}]`); }
      else if (r === 13) { const p = `note.${pick(PROPS)}`; f.properties = { ...(f.properties ?? {}) }; const e = { ...(f.properties[p] ?? {}) }; const pv = { ...(e.plainva ?? {}) }; pv.input = pv.input ?? "select"; pv.options = [...(pv.options ?? []), { value: `v${++fresh}` }]; e.plainva = pv; f.properties[p] = e; ops.push(`F.options[${p}]`); }
    }
    return { raw: f, ids: fids, ops };
  }

  // --- oracle merge (raw data), written from the agreed rules, not from the branch ---
  function mergeListO(b: any[], a: any[], f: any[]): any[] {
    const kb = distinct(b), ka = distinct(a), kf = distinct(f);
    if (!kb || !ka || !kf) return a;
    const bm = new Map(kb.map((k, i) => [k, b[i]])), fm = new Map(kf.map((k, i) => [k, f[i]]));
    const out: any[] = [];
    ka.forEach((k, i) => {
      if (bm.has(k) && !fm.has(k) && deq(a[i], bm.get(k))) return; // file removed it, app left it
      out.push(fm.has(k) ? mergeO(bm.get(k), a[i], fm.get(k)) : a[i]);
    });
    kf.forEach((k, i) => { if (!bm.has(k) && !ka.includes(k)) out.push(f[i]); }); // file added
    return out;
  }
  const ENTITY = new Set(["properties", "formulas", "summaries", "widths"]);
  const emptyOfO = (v: any) => (Array.isArray(v) ? [] : isObj(v) ? {} : undefined);
  const isEmptyO = (v: any) => (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).filter((k) => v[k] !== undefined).length === 0);
  function mergeO(b: any, a: any, f: any, key?: string): any {
    if (deq(a, b)) return f;
    if (deq(f, b)) return a;
    if (deq(a, f)) return a;
    if (key === "filters") return a; // agreed rule (17.11.): a filter both changed is the user's
    if (Array.isArray(a) && Array.isArray(f)) return mergeListO(Array.isArray(b) ? b : [], a, f);
    if (isObj(a) && isObj(f)) {
      const bb = isObj(b) ? b : {};
      const out: any = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(f)])) {
        const av = a[k], fv = f[k], bv = bb[k];
        if (av === undefined) {
          if (fv === undefined) continue;
          if (bv === undefined) { out[k] = fv; continue; }
          // app removed: an entity, a filter, a scalar goes; an emptied container keeps what the file added
          const e = ENTITY.has(key ?? "") || k === "filters" ? undefined : emptyOfO(bv);
          if (e === undefined) continue;
          const kept = mergeO(bv, e, fv, k);
          if (!isEmptyO(kept)) out[k] = kept;
          continue;
        }
        if (fv === undefined) { if (bv !== undefined && deq(av, bv)) continue; out[k] = av; continue; }
        out[k] = mergeO(bv, av, fv, k);
      }
      return out;
    }
    return a;
  }

  const stats: Record<string, number> = {};
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1; };
  for (let n = 0; n < N; n++) {
    const T0n = serializeBaseConfig(loadBaseConfigText(yaml.stringify(genRaw())));
    if (serializeBaseConfig(loadBaseConfigText(T0n)) !== T0n) { bump("skip:not-fixed-point"); continue; }
    const Bn = yaml.parse(T0n);
    const unnamed = new Set<number>();
    Bn.views.forEach((v: any, i: number) => { if (rnd() < PUN) { delete v.name; unnamed.add(i); } });
    const T0 = yaml.stringify(Bn);
    const shown = loadBaseConfigText(T0);
    const B = yaml.parse(T0);
    const bIds = B.views.map((_: any, i: number) => i);
    const { next, ids: aIds, ops: aOps, renamed } = appMutate(shown, bIds);
    const A = yaml.parse(serializeBaseConfig(next));
    const { raw: F, ids: fIds, ops: fOps } = fileMutate(B, bIds);
    const fileText = yaml.stringify(F);
    const TOPONLY = new Set(["F.formula","F.zz"]);
    const fcls = fOps.length === 0 ? "none" : fOps.every((o) => TOPONLY.has(o) || o.startsWith("F.displayName") || o.startsWith("F.options")) ? "toponly" : fOps.some((o) => /^F\.(rename|delete|add|move)/.test(o)) ? "structural" : "viewedit";
    bump(`cases:${fcls}`);
    // name handling: an id that is unnamed in B and not renamed by the app has a synthesized name in A and R — strip it.
    const stripName = (id: number, v: any) => { if (v && unnamed.has(id) && !renamed.has(id)) { const { name: _n, ...r } = v; return r; } return v; };
    const by = (vs: any[], ids: number[], strip: boolean) => new Map(ids.map((id, i) => [id, strip ? stripName(id, vs[i]) : vs[i]]));
    const Bm = by(B.views, bIds, true), Am = by(A.views, aIds, true), Fm = by(F.views, fIds, false);
    // app-added duplicates carry no B entry
    let mustRefuse = false;
    const expected: { id: number; v: any; exact: boolean }[] = [];
    for (const id of new Set([...bIds, ...aIds, ...fIds])) {
      const b = Bm.get(id), a = Am.get(id), f = Fm.get(id);
      if (b === undefined) { if (a) expected.push({ id, v: a, exact: false }); if (f) expected.push({ id, v: f, exact: true }); continue; }
      if (a === undefined) continue; // app deleted: gone
      const appChanged = !deq(a, b);
      if (f === undefined) { if (appChanged) mustRefuse = true; continue; }
      expected.push(appChanged ? { id, v: mergeO(b, a, f), exact: false } : { id, v: f, exact: true });
    }
    const expTop = (() => { const s = (x: any) => { const { views: _v, ...r } = x; return r; }; const a = s(A); if (a.properties === undefined && B.properties !== undefined) a.properties = {}; const t = mergeO(s(B), a, s(F)); if (isObj(t.properties) && Object.keys(t.properties).length === 0) delete t.properties; return t; })();
    const keepOne = expected.length === 0;
    let Rt: string | null = null, refused = false, err: any = null, reason = "";
    try { Rt = rebaseBaseConfigText(shown, next, fileText).text; }
    catch (e: any) { if (e instanceof BaseConfigChangeRefusedError) { refused = true; reason = e.reason; } else err = e; }
    const problems: string[] = [];
    if (err) problems.push(`THROW ${err?.message}`);
    if (refused) { const fr = fOps.some((o) => o.startsWith("F.rename")) ? ":fileRenamed" : ""; const tg = `${unnamed.size ? ":unnamed" : ""}${new Set(B.views.map((v: any) => v.name)).size < B.views.length ? ":dupnames" : ""}`; bump(`refusedBy:${fcls}:${mustRefuse ? "expected" : reason}${tg}`); if (!mustRefuse && B.views.length === 1 && F.views.length === 1 && A.views.length === 1) bump(`refusedSingleView:${fcls}${tg}`); bump(mustRefuse ? "refused:expected" : `refused:${reason}${fr}${unnamed.size ? ":unnamed" : ""}${new Set(B.views.map((v: any) => v.name)).size < B.views.length ? ":dupnames" : ""}`); }
    if (Rt !== null && keepOne) bump("rule:both-removed-all-user-keeps");
    if (Rt !== null && !keepOne) {
      if (mustRefuse) problems.push("WRITE where the app changed a view the file deleted");
      const R = yaml.parse(Rt);
      // match R views to expected by canonical text, after stripping synthesized names where the expected view has none
      const left = expected.slice();
      const unmatched: any[] = [];
      for (const rv of R.views ?? []) {
        let k = left.findIndex((e) => canon(canonView(e.v)) === canon(canonView(rv)));
        if (k < 0) k = left.findIndex((e) => e.v.name === undefined && canon(e.v) === canon((({ name: _n, ...r }) => r)(rv)));
        if (k < 0) { unmatched.push(rv); continue; }
        const e = left.splice(k, 1)[0];
        if (e.exact && JSON.stringify(rv) !== JSON.stringify(e.v) && e.v.name !== undefined) bump("note:untouched view key order changed");
      }
      if (left.length) problems.push(`LOST views ${JSON.stringify(left.map((e) => ({ id: e.id, v: e.v })))}`);
      if (unmatched.length) problems.push(`EXTRA/WRONG views ${JSON.stringify(unmatched)}`);
      const { views: _v, ...Rtop } = R;
      if (canon(Rtop) !== canon(expTop)) problems.push(`TOP differs: got ${JSON.stringify(Rtop)} want ${JSON.stringify(expTop)}`);
    }
    if (problems.length) {
      bump("FAIL");
      const cls = problems.map((p) => p.split(" ")[0]).join("+");
      bump(`fail:${cls}${[...unnamed].length ? ":unnamed" : ""}${new Set(B.views.map((v: any) => v.name)).size < B.views.length ? ":dupnames" : ""}`);
      failures.push({ app: aOps.join(","), file: fOps.join(","), problems: problems.join(" | "), singleView: B.views.length === 1 && F.views.length === 1 });
    } else bump(refused ? "ok:refused" : "ok:written");
  }

  return { stats, failures };
}

describe("database view changes over random edits on both sides (B20)", () => {
  for (const seed of [1, 2]) {
    it(`seed ${seed}: never a wrong write but the named limit, never a refusal at an unchanged file or a one-view database`, () => {
      const { stats, failures } = runCases(seed, 1000);
      const unchangedRefused = Object.entries(stats).filter(([k]) => k.startsWith("refusedBy:none:") && !k.includes(":expected")).reduce((n, [, v]) => n + v, 0);
      const singleViewRefused = Object.entries(stats).filter(([k]) => k.startsWith("refusedSingleView:")).reduce((n, [, v]) => n + v, 0);
      expect(unchangedRefused).toBe(0);
      expect(singleViewRefused).toBe(0);
      // The named limit: the file deleted a view and added another; that one takes the change, nothing is lost.
      const beyondLimit = failures.filter((f) => !(/F\.delete/.test(f.file) && /F\.add/.test(f.file)));
      expect(beyondLimit).toEqual([]);
      expect(stats["ok:written"] ?? 0).toBeGreaterThan(800);
    }, 60_000);
  }
});
