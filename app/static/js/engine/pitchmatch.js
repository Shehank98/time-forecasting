/* Client Pitch Evaluator: programme name matching. Pure functions (worker, page and tests).
 *
 * LMRB and TVR name the same programme differently, so a name is compared in several ways and the best reading wins:
 *  - cleaned text: repeat marks (RPT, REP), season / episode / part numbers, times ("@ 6.55"), brackets and filler words are dropped
 *  - letters: bigram overlap and edit distance (typing slips, "Lakshapathi" / "Lakshapathy")
 *  - sound: Sinhala and Tamil spellings are reduced to a consonant skeleton (th = t, w = v, ee = i, y = i, double letters, vowels), so
 *    "Hitha Illana Tharu" and "Hithe Ilana Taru" meet, and so do "Mayawee" / "Mayawi" and "Sangeethe" / "Sangeetha"
 *  - words: each word finds its closest word on the other side (generic words like news, show, movie count for little)
 *  - one name inside the other ("Sirasa Lakshapathi" / "Lakshapathi"), initials ("AMOA" / "Aththamai Man Oyata Adarei")
 *  - kind of programme: movie, news, kids, music, reality, drama on both sides
 */
(function (root) {
  const MR = root.MR = root.MR || {};
  const DROP = new Set(['rpt', 'rep', 'repeat', 'rerun', 'repeated', 're', 'live', 'new', 'special', 'the', 'a', 'an', 'of', 'and', 'with', 'at', 'on', 'in', 'tv', 'hd', 'ep', 'episode', 'season', 'part', 'nn', 'pm', 'am', 'vs']);
  const GENERIC = new Set(['news', 'show', 'drama', 'movie', 'movies', 'cinema', 'film', 'films', 'tele', 'teledrama', 'programme', 'program', 'morning', 'evening', 'night', 'day', 'weekend', 'weekday', 'studio',
    'music', 'song', 'songs', 'chat', 'kids', 'cartoon', 'talk', 'main', 'prime', 'time', 'late', 'early', 'one', 'two', 'sirasa', 'derana', 'hiru', 'siyatha', 'swarnavahini', 'shakthi', 'itn', 'rupavahini', 'tamil', 'sinhala', 'english']);
  const KINDS = {
    movie: /^(movie|movies|cinema|film|films|telefilm|telecinema|blockbuster|flick)$/, news: /^(news|headlines|bulletin|vistara)$/, kids: /^(kids|kid|cartoon|cartoons|junior|toon|toons|baby|tiny)$/,
    music: /^(music|chart|charts|song|songs|hits|countdown|concert|beats|karaoke)$/, reality: /^(reality|voice|star|stars|idol|talent|dancing|dance|champion|champions|challenge)$/, quiz: /^(quiz|lakshapathi|millionaire|jackpot)$/,
  };
  const cache = new Map();

  function skel(t) {
    let s = String(t).toLowerCase().replace(/ph/g, 'f').replace(/[td]h/g, (m) => m[0]).replace(/sh|ch|kh|gh|bh/g, (m) => m[0]).replace(/w/g, 'v').replace(/z/g, 's').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/y/g, 'i').replace(/c/g, 'k');
    s = s.replace(/(.)\1+/g, '$1');
    return s[0] + s.slice(1).replace(/[aeiou]+/g, '');
  }
  function lev(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    let p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[b.length];
  }
  const ratio = (a, b) => (a || b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);
  const bigrams = (t) => { const o = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1); } return o; };
  function dice(A, B, na, nb) { let hit = 0; A.forEach((v, k) => { if (B.has(k)) hit += Math.min(v, B.get(k)); }); return na + nb ? (2 * hit) / (na + nb) : 0; }

  /** A name prepared once: cleaned words, sound skeleton, bigrams, initials, kind of programme, repeat mark. */
  function prep(raw) {
    const key = String(raw == null ? '' : raw); let p = cache.get(key); if (p) return p;
    const low = key.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    const all = low.split(' ').filter(Boolean), repeat = all.some((t) => /^(rpt|rep|repeat|rerun|repeated)$/.test(t));
    const tokens = all.filter((t) => !DROP.has(t) && !/^\d+$/.test(t) && !/^(s|sn|se|ep|e|part|pt)\d+$/.test(t));
    const text = tokens.join(''), kinds = new Set(); tokens.forEach((t) => { for (const [k, re] of Object.entries(KINDS)) if (re.test(t)) kinds.add(k); });
    const t = tokens.join(' ');
    p = { raw: key, tokens, text, spaced: t, sk: skel(text), skt: tokens.map(skel), big: bigrams(text), nb: Math.max(0, text.length - 1), initials: tokens.map((x) => x[0]).join(''), kinds, repeat };
    if (cache.size > 60000) cache.clear();
    cache.set(key, p); return p;
  }
  function tokSim(a, sa, b, sb) {
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.88;
    let s = ratio(a, b);
    if (a.length >= 4 && b.length >= 4 && sa.length >= 2 && sb.length >= 2) s = Math.max(s, 0.92 * ratio(sa, sb));
    else if (sa === sb && a.length >= 3) s = Math.max(s, 0.8);
    return s;
  }
  function oneWay(A, B) {
    let w = 0, tot = 0;
    A.tokens.forEach((t, i) => {
      const wt = GENERIC.has(t) ? 0.35 : Math.min(t.length, 8); tot += wt;
      let best = 0; B.tokens.forEach((u, j) => { const s = tokSim(t, A.skt[i], u, B.skt[j]); if (s > best) best = s; }); w += wt * best;
    });
    return tot ? w / tot : 0;
  }
  /** 0..1 how alike two programme names are, the best of the readings above. */
  function scorePrepared(A, B) {
    if (!A.text || !B.text) return 0;
    if (A.text === B.text) return A.repeat !== B.repeat ? 0.97 : 1;
    const parts = [dice(A.big, B.big, A.nb, B.nb)];
    const ab = oneWay(A, B), ba = oneWay(B, A), avg = (ab + ba) / 2;
    parts.push(avg);
    if (Math.min(ab, ba) >= 0.9 && Math.max(ab, ba) >= 0.9) parts.push(0.9);
    const small = ab >= ba ? B : A, big = ab >= ba ? A : B, contained = Math.max(ab, ba) >= 0.95 && small.tokens.some((t) => t.length >= 4 && !GENERIC.has(t)) && Math.min(ab, ba) >= 0.2;       // every word of one name is in the other
    if (contained) parts.push(0.86);
    if (A.text.length >= 5 && B.text.length >= 5) { if (A.text.includes(B.text) || B.text.includes(A.text)) parts.push(0.9); if (A.sk.length >= 3 && B.sk.length >= 3) parts.push(0.9 * ratio(A.sk, B.sk)); }
    const ini = (X, Y) => X.tokens.length >= 3 && Y.tokens.length === 1 && Y.text.length >= 3 && X.initials === Y.text;
    if (ini(A, B) || ini(B, A)) parts.push(0.8);
    const best = Math.min(1, Math.max(...parts));
    const specific = (X) => X.tokens.some((t) => !GENERIC.has(t));
    return !specific(A) || !specific(B) ? Math.min(best, 0.5) : best;        // names made only of words like news, show, movie say little on their own
  }
  const score = (a, b) => scorePrepared(prep(a), prep(b));
  /** Do both names look like the same kind of programme (a movie, the news, kids, music, reality)? */
  const sameKind = (A, B) => [...A.kinds].some((k) => B.kinds.has(k));

  Object.assign(MR, { pitchPrep: prep, pitchNameScore: score, pitchNameScorePrepared: scorePrepared, pitchSameKind: sameKind, pitchSkeleton: skel });
})(typeof self !== 'undefined' ? self : globalThis);
