// The idea tree. One trunk splits into a few big branches, each big branch into smaller ones, and every
// idea is a leaf. You never read everything at once: tap a branch to zoom into it, tap a smaller branch
// to read its ideas. Each view is drawn as its own tree, and the branch you tapped becomes the trunk.
// An idea worth building is a fruit.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const CALLS = [
    [70, "build it", "build"],
    [40, "sharpen it", "sharp"],
    [0, "drop it or flip it", "drop"],
  ];
  const call = (s) => CALLS.find(([min]) => s >= min);
  const $ = (id) => document.getElementById(id);
  const svg = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const r1 = (n) => Math.round(n * 10) / 10;
  // ?static draws the finished tree with no motion (screenshots, slow machines).
  const still = new URLSearchParams(location.search).has("static") || matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The same name always bends the same way, so it is the same tree every time it is drawn.
  const hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const sway = (key, amount) => ((hash(key) % 2000) / 1000 - 1) * amount;

  // The night sky behind the tree: three depths of stars that breathe, a few bright ones with a glow,
  // and now and then one that falls.
  const skyStars = [];
  let skyW = 0, skyH = 0, skyD = 1, falling = null, lastSky = 0;
  function seedSky() {
    const c = $("sky");
    skyD = Math.min(2, devicePixelRatio || 1);
    skyW = c.width = innerWidth * skyD;
    skyH = c.height = innerHeight * skyD;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    skyStars.length = 0;
    const count = Math.round(Math.min(1100, (innerWidth * innerHeight) / 1500));
    for (let i = 0; i < count; i++) {
      const depth = rnd(); // 0 far and faint, 1 near and bright
      skyStars.push({
        x: rnd() * skyW, y: rnd() * skyH,
        r: (depth > 0.985 ? 1.9 : depth > 0.9 ? 1.2 : 0.35 + depth * 0.6) * skyD,
        a: 0.18 + depth * 0.72, speed: 0.4 + rnd() * 1.6, phase: rnd() * 6.28, glow: depth > 0.985,
        tint: rnd() < 0.22 ? "#a9c4ff" : rnd() < 0.1 ? "#ffe2b0" : "#ffffff",
      });
    }
  }
  function drawSky(now) {
    const g = $("sky").getContext("2d"), t = now / 1000;
    g.clearRect(0, 0, skyW, skyH);
    for (const st of skyStars) {
      const twinkle = still ? 1 : 0.62 + 0.38 * Math.sin(t * st.speed + st.phase);
      g.globalAlpha = st.a * twinkle;
      g.fillStyle = st.tint;
      if (st.glow) {
        const halo = g.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r * 7);
        halo.addColorStop(0, st.tint);
        halo.addColorStop(0.18, "rgba(170, 196, 255, 0.35)");
        halo.addColorStop(1, "rgba(170, 196, 255, 0)");
        g.fillStyle = halo;
        g.fillRect(st.x - st.r * 7, st.y - st.r * 7, st.r * 14, st.r * 14);
        g.fillStyle = "#ffffff";
        g.fillRect(st.x - st.r * 5, st.y - 0.35 * skyD, st.r * 10, 0.7 * skyD); // a thin glint across
        g.fillRect(st.x - 0.35 * skyD, st.y - st.r * 5, 0.7 * skyD, st.r * 10);
      }
      g.beginPath();
      g.arc(st.x, st.y, st.r, 0, 6.3);
      g.fill();
    }
    if (falling) {
      const k = (now - falling.t0) / falling.ms;
      if (k >= 1) falling = null;
      else {
        const x = falling.x + falling.dx * k, y = falling.y + falling.dy * k, tail = 0.16;
        const trail = g.createLinearGradient(x, y, x - falling.dx * tail, y - falling.dy * tail);
        trail.addColorStop(0, `rgba(255,255,255,${0.9 * Math.sin(k * Math.PI)})`);
        trail.addColorStop(1, "rgba(255,255,255,0)");
        g.globalAlpha = 1;
        g.strokeStyle = trail;
        g.lineWidth = 1.6 * skyD;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - falling.dx * tail, y - falling.dy * tail);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  function tickSky(now) {
    if (now - lastSky > 40) {
      lastSky = now;
      if (!falling && Math.random() < 0.004) falling = { t0: now, ms: 900 + Math.random() * 500, x: Math.random() * skyW * 0.8, y: Math.random() * skyH * 0.35, dx: (0.25 + Math.random() * 0.2) * skyW, dy: (0.12 + Math.random() * 0.12) * skyH };
      drawSky(now);
    }
    requestAnimationFrame(tickSky);
  }
  seedSky();
  drawSky(0);
  if (!still) requestAnimationFrame(tickSky);
  addEventListener("resize", () => (seedSky(), drawSky(performance.now())));

  let data = null;
  let known = null; // ids already seen, so only a real arrival moves the tree
  let picked = null; // the idea someone tapped
  let landing = null;
  let seenRaw = "";
  let box = "";
  let path = []; // [] the whole tree, [big branch], or [big branch, smaller branch]
  let shown = null; // what the view on screen was drawn from
  let current = null; // the view on screen
  const rank = new Map(); // where each branch was first drawn. A new idea adds a leaf, it does not shuffle the tree.
  const place = (key) => rank.get(key) ?? rank.set(key, rank.size).get(key);

  // ---- where you are, kept in the address so Back zooms out and a link lands on a branch
  const toHash = (p) => (p.length ? `#/${p.map(encodeURIComponent).join("/")}` : "");
  const fromHash = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const trunkOf = (name) => data.trunks.find((t) => t.name === name);
  const fit = (p) => {
    const t = p[0] && trunkOf(p[0]);
    if (!t) return [];
    return p[1] && t.branches.some((b) => b.name === p[1]) ? [p[0], p[1]] : [p[0]];
  };
  const find = (id) => {
    for (const t of data?.trunks ?? []) for (const b of t.branches) for (const idea of b.ideas) if (idea.id === id) return { idea, home: [t.name, b.name] };
    return null;
  };

  // ---- what one view shows: the branches of the place you are standing
  function model(p) {
    const tally = (ideas) => ({ count: ideas.length, real: ideas.filter((i) => !i.sample).length });
    // On first sight the biggest branch is lowest, like a real tree. After that everything keeps its place.
    const settle = (kids) => {
      kids.sort((a, b) => b.count - a.count);
      for (const k of kids) place(k.key);
      return kids.sort((a, b) => place(a.key) - place(b.key));
    };
    if (!p.length) {
      return {
        level: 0,
        kids: settle(data.trunks.map((t) => ({ key: `t:${t.name}`, name: t.name, go: [t.name], groups: t.branches.map((b) => b.ideas), ...tally(t.branches.flatMap((b) => b.ideas)) }))),
      };
    }
    const t = trunkOf(p[0]);
    if (p.length === 1) {
      return { level: 1, kids: settle(t.branches.map((b) => ({ key: `b:${t.name}/${b.name}`, name: b.name, go: [t.name, b.name], groups: [b.ideas], ...tally(b.ideas) }))) };
    }
    // The best idea sits highest.
    const ideas = [...t.branches.find((b) => b.name === p[1]).ideas].sort((a, b) => a.score - b.score || b.at.localeCompare(a.at));
    return { level: 2, kids: ideas.map((idea) => ({ key: `i:${idea.id}`, idea, count: 1 })) };
  }

  // ---- drawing
  const cubic = (a, c1, c2, b, n) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n, u = 1 - t;
      return {
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      };
    });
  const heading = (pts, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // A branch: a center line whose width narrows all the way to the tip, drawn as one closed shape.
  // Where it joins the trunk it swells into a collar, the way real wood does.
  function limb(pts, w0, w1, collar = 0) {
    const L = [], R = [];
    pts.forEach((p, i) => {
      const t = i / (pts.length - 1), a = heading(pts, i) + Math.PI / 2;
      const w = (w1 + (w0 - w1) * Math.pow(1 - t, 1.12) + w0 * collar * Math.pow(Math.max(0, 1 - t / 0.13), 2)) / 2;
      L.push(`${r1(p.x + Math.cos(a) * w)},${r1(p.y + Math.sin(a) * w)}`);
      R.push(`${r1(p.x - Math.cos(a) * w)},${r1(p.y - Math.sin(a) * w)}`);
    });
    const end = pts[pts.length - 1], dir = heading(pts, pts.length - 1);
    return `M${L.join(" L")} Q${r1(end.x + Math.cos(dir) * w1 * 0.8)},${r1(end.y + Math.sin(dir) * w1 * 0.8)} ${R.reverse().join(" L")} Z`;
  }
  const LEAF = "M0,0C0.28,-0.3 0.7,-0.27 1,0C0.7,0.27 0.28,0.3 0,0Z";

  function build(m, W, H) {
    const view = node("div", `view l${m.level}`);
    const art = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    const tags = node("div", "tags");
    view.append(art, tags);
    view.tips = new Map(); // where each branch ends, so a zoom knows where to aim
    const kids = m.kids, n = kids.length;
    if (!n) return view;

    const narrow = W < 640;
    // On a phone, one branch's ideas all grow to the right of the stem, so every name gets a full line.
    const oneSided = narrow && m.level === 2;
    const s = Math.max(0.52, Math.min(1.3, Math.min(W / 1150, H / 780)));
    const top = narrow ? 76 : 86, baseY = H - (narrow ? 26 : 40), U = baseY - top;
    const cx = oneSided ? 42 : W / 2;
    const step = (U * 0.72) / n; // how far apart two neighbors end
    const edge = narrow ? 16 : 22; // names keep this far from the side of the screen
    const labelW = m.level === 2 ? Math.max(108, Math.min(250, W * 0.21)) : Math.max(92, Math.min(190, W * 0.15));
    const leafLen = m.level === 0 ? 15.5 * s : m.level === 1 ? Math.max(14 * s, Math.min(40 * s, step * 0.8)) : Math.max(26 * s, Math.min(62 * s, step * 1.3));
    // How far the leaves reach past the end of a branch.
    const bush = m.level === 0 ? Math.max(24 * s, Math.min(60 * s, step * 1.1)) : m.level === 1 ? leafLen * 1.1 : leafLen * 0.7;
    const past = m.level === 0 ? bush * 1.2 : bush; // and how far the crown does
    // Zoomed in, a branch is drawn compact: shorter wood, names close by.
    const rx = oneSided ? 60 : Math.max(50, Math.min(W / 2 - labelW - past - (narrow ? 12 : 26), [9999, 430, 290][m.level] * s));
    const trunkW = [54, 36, 26][m.level] * s * (narrow ? 0.74 : 1);
    const most = Math.max(...kids.map((k) => k.count));
    view.style.setProperty("--fn", `${r1(m.level === 2 ? Math.max(15, Math.min(18, 17 * s + 1)) : Math.max(14, Math.min(23, 21 * s)))}px`);
    view.style.setProperty("--fc", `${r1(Math.max(12, Math.min(15, 14.5 * s)))}px`);

    // Branches leave the trunk one after another, left then right, and climb: each one ends well above
    // where it started, the way real limbs reach for light.
    const low = oneSided ? 0.12 : narrow ? 0.26 : 0.4; // how far up the first one ends
    kids.forEach((k, i) => {
      const t = (i + 0.5) / n, side = oneSided || i % 2 ? 1 : -1;
      const reach = rx * (1 - (oneSided ? 0.2 : 0.74) * Math.pow(t, 1.9)) * (1 + sway(`${k.key}r`, 0.05));
      const T = { x: cx + side * reach, y: baseY - U * (low + (0.97 - low) * t) + sway(`${k.key}y`, step * 0.14) };
      k.geo = { side, T, ay: Math.min(baseY - U * 0.14, T.y + reach * 0.62 + U * 0.05) };
    });
    const trunkH = baseY - Math.min(...kids.map((k) => k.geo.ay));
    const leader = kids.reduce((a, b) => (b.geo.ay < a.geo.ay ? b : a)); // the branch that carries the trunk on
    const lean = (u) => (Math.sin(u * Math.PI * 1.2) * 15 - u * 8) * s * (oneSided ? 0.4 : 1);
    const at = (y) => {
      const u = Math.max(0, Math.min(1, (baseY - y) / trunkH));
      return { x: cx + lean(u), w: trunkW * (1 - 0.66 * u) + trunkW * 0.7 * Math.pow(Math.max(0, 1 - u / 0.16), 2) };
    };

    const canopy = svg("g", { class: m.level ? "" : "canopy" }), crowns = svg("g"), lights = svg("g"), limbs = svg("g");
    canopy.append(crowns, lights);
    art.append(svg("ellipse", { class: "hill", cx: r1(W / 2), cy: r1(baseY + 48 * s), rx: r1(Math.min(W * 0.47, 380 * s + 90)), ry: r1(64 * s) }), canopy);
    const spine = Array.from({ length: 19 }, (_, i) => {
      const y = baseY + 12 - (i / 18) * (trunkH + 12);
      return { y, ...at(y) };
    });
    const up = svg("g", { class: m.level ? "up" : "" });
    up.append(
      svg("path", { class: "bark", d: `M${spine.map((p) => `${r1(p.x - p.w / 2)},${r1(p.y)}`).join(" L")} L${[...spine].reverse().map((p) => `${r1(p.x + p.w / 2)},${r1(p.y)}`).join(" L")} Z` }),
      svg("circle", { class: "bark", cx: r1(spine[18].x), cy: r1(spine[18].y), r: r1(spine[18].w / 2) }),
    );
    art.append(up, limbs);

    const leaf = (g, x, y, a, size, idea) => {
      const band = call(idea.score)[2];
      const len = size;
      const cls = `lf ${band}${idea.id === landing ? " landing" : ""}`;
      const mid = { x: x + Math.cos(a) * len * 0.55, y: y + Math.sin(a) * len * 0.55 };
      // Zoomed in, each leaf sits in a little light of its own.
      if (m.level) crowns.append(svg("circle", { class: "glow", cx: r1(mid.x), cy: r1(mid.y), r: r1(len * (m.level === 2 ? 0.56 : 0.5)) }));
      if (band === "build") {
        g.append(svg("path", { class: "stem", d: `M${r1(x)},${r1(y)}L${r1(mid.x)},${r1(mid.y)}` }), svg("circle", { class: cls, cx: r1(mid.x), cy: r1(mid.y), r: r1(len * 0.36) }));
      } else {
        g.append(svg("path", { class: `${cls} v${hash(idea.id) % 3}`, d: LEAF, transform: `translate(${r1(x)} ${r1(y)}) rotate(${r1((a * 180) / Math.PI)}) scale(${r1(len)})` }));
      }
      // The newest idea keeps a slow ring for a few minutes, so the one that just landed can be found.
      if (idea.id === data.latest && Date.now() - Date.parse(idea.at) < 10 * 60_000) g.append(svg("circle", { class: "ping", cx: r1(mid.x), cy: r1(mid.y), r: r1(Math.max(9, len * 0.6)) }));
      return mid;
    };
    // A twig with its leaves: one at the end, the rest stepping up it on alternate sides. The best idea gets the end.
    const sprig = (g, x, y, a, len, ideas, puffs) => {
      const end = { x: x + Math.cos(a) * len, y: y + Math.sin(a) * len };
      g.append(svg("path", { class: "twig", d: `M${r1(x)},${r1(y)}L${r1(end.x)},${r1(end.y)}`, "stroke-width": r1(Math.max(1.3, leafLen * 0.15)) }));
      puffs.push([end, 0.66]); // crown wherever there are leaves, so no twig hangs out in the open
      const sorted = [...ideas].sort((p, q) => p.score - q.score);
      sorted.forEach((idea, j) => {
        if (j === sorted.length - 1) return leaf(g, end.x, end.y, a, leafLen, idea);
        const f = 0.28 + (0.72 * (j + 1)) / sorted.length;
        leaf(g, x + Math.cos(a) * len * f, y + Math.sin(a) * len * f, a + (j % 2 ? 1 : -1) * (0.9 + sway(idea.id, 0.2)), leafLen * (0.88 + sway(`${idea.id}s`, 0.1)), idea);
      });
    };

    kids.forEach((k, i) => {
      const { side, T, ay } = k.geo;
      const root = at(ay), A = { x: root.x, y: ay };
      const dx = T.x - A.x, dy = T.y - A.y;
      // Up and out of the trunk at a steep angle, then arching over toward its end.
      const pts = cubic(
        A,
        { x: A.x + dx * 0.22 + sway(`${k.key}a`, Math.abs(dx) * 0.04), y: A.y + dy * 0.5 },
        { x: A.x + dx * 0.62, y: A.y + dy * 0.88 + sway(`${k.key}b`, Math.abs(dx) * 0.04) },
        T,
        24,
      );
      const last = pts.length - 1;
      const w0 = k === leader ? root.w : m.level === 2 ? Math.max(3.5 * s, trunkW * 0.34) : Math.min(root.w * 0.72, Math.max(5 * s, trunkW * 0.42 * Math.sqrt(k.count / most) + 3 * s));
      const g = svg("g", { class: `kid${k.idea && k.idea.id === picked ? " on" : ""}`, "data-k": i });
      g.append(svg("path", { class: "bark", d: limb(pts, w0, Math.max(1.5 * s, w0 * 0.1), k === leader ? 0 : 0.55) }));
      const dir = heading(pts, last);
      const puffs = [];
      let spot = T; // where the name goes: just past the leaves
      if (m.level === 2) {
        spot = leaf(g, T.x, T.y, dir, leafLen, k.idea);
      } else if (m.level === 1) {
        const ideas = [...k.groups[0]].sort((p, q) => p.score - q.score);
        ideas.forEach((idea, j) => {
          const end = j === ideas.length - 1;
          const idx = end ? last : Math.round((0.34 + (0.62 * (j + 0.5)) / ideas.length) * last);
          const h = heading(pts, idx), a = end ? h : h + (j % 2 ? 1 : -1) * (1.05 + sway(idea.id, 0.2));
          const stem = end ? 0 : leafLen * 0.34;
          const p = { x: pts[idx].x + Math.cos(a) * stem, y: pts[idx].y + Math.sin(a) * stem };
          if (stem) g.append(svg("path", { class: "twig", d: `M${r1(pts[idx].x)},${r1(pts[idx].y)}L${r1(p.x)},${r1(p.y)}`, "stroke-width": r1(Math.max(1.3, leafLen * 0.08)) }));
          leaf(g, p.x, p.y, a, leafLen * (end ? 1 : 0.9), idea);
        });
      } else {
        // A big branch forks once, part way out, the way real wood does. The fork reaches for the light,
        // and the twigs take turns between the two arms.
        const at0 = Math.round(0.46 * last), from = pts[at0], h0 = heading(pts, at0);
        const reachF = Math.hypot(T.x - from.x, T.y - from.y) * (0.52 + sway(`${k.key}f`, 0.08));
        const aim = h0 - side * (0.5 + sway(`${k.key}g`, 0.12));
        const tipF = { x: from.x + Math.cos(aim) * reachF, y: from.y + Math.sin(aim) * reachF };
        const arm = cubic(
          from,
          { x: from.x + Math.cos(h0) * reachF * 0.36, y: from.y + Math.sin(h0) * reachF * 0.36 },
          { x: tipF.x - Math.cos(aim - side * 0.3) * reachF * 0.3, y: tipF.y - Math.sin(aim - side * 0.3) * reachF * 0.3 },
          tipF,
          12,
        );
        const fork = k.groups.length > 3;
        const wAt = Math.max(1.5 * s, w0 * 0.1) + (w0 - Math.max(1.5 * s, w0 * 0.1)) * Math.pow(1 - 0.46, 1.12);
        if (fork) g.append(svg("path", { class: "bark", d: limb(arm, wAt * 0.8, Math.max(1.4 * s, w0 * 0.08)) }));
        const mine = fork ? k.groups.filter((_, gi) => gi % 2 === 0 || gi === k.groups.length - 1) : k.groups;
        const theirs = fork ? k.groups.filter((_, gi) => gi % 2 === 1 && gi !== k.groups.length - 1) : [];
        const dress = (line, groups, start, tag) =>
          groups.forEach((ideas, gi) => {
            const end = gi === groups.length - 1, upto = line.length - 1;
            const idx = end ? upto : Math.round((start + ((1 - start) * (gi + 0.5)) / groups.length) * upto);
            const h = heading(line, idx);
            sprig(g, line[idx].x, line[idx].y, end ? h : h + (gi % 2 ? 1 : -1) * (0.75 + sway(`${k.key}${tag}${gi}`, 0.22)), bush * (0.4 + 0.085 * Math.sqrt(ideas.length)), ideas, puffs);
          });
        dress(pts, mine, fork ? 0.58 : 0.4, "m");
        dress(arm, theirs, 0.3, "f");
        puffs.push([pts[Math.round(0.5 * last)], 0.85], [pts[Math.round(0.75 * last)], 1.1], [pts[last], 1.2]);
        if (fork) puffs.push([tipF, 1.1]);
        // The crown: one soft mass per branch, lighter where it faces up.
        const middle = puffs.reduce((sum, [p]) => sum + p.y, 0) / puffs.length;
        for (const [p, size] of puffs) (p.y < middle ? lights : crowns).append(svg("circle", { class: `crown ${p.y < middle ? "hi" : "lo"}`, cx: r1(p.x), cy: r1(p.y), r: r1(bush * size) }));
      }
      g.append(svg("circle", { class: "hit", cx: r1(T.x), cy: r1(T.y), r: r1(past + 10) }));
      limbs.append(g);
      view.tips.set(k.key, T);

      const tag = node("button", `tag ${side < 0 ? "l" : "r"}`);
      tag.type = "button";
      tag.dataset.k = i;
      // The name sits just past the leaves, and never closer to the side of the screen than the gutter.
      const off = m.level === 2 ? leafLen * 0.6 + (narrow ? 7 : 10) : past + (narrow ? 4 : 10);
      const room = side < 0 ? spot.x - off - edge : W - (spot.x + off) - edge;
      tag.style.top = `${r1(m.level === 2 ? spot.y : T.y - 4)}px`;
      if (side < 0) tag.style.right = `${r1(W - (spot.x - off))}px`;
      else tag.style.left = `${r1(spot.x + off)}px`;
      tag.style.maxWidth = `${r1(Math.max(64, Math.min(oneSided ? 999 : labelW, room)))}px`;
      if (m.level === 2) {
        const { idea } = k;
        tag.classList.add(call(idea.score)[2]);
        if (idea.id === picked) tag.classList.add("on");
        if (idea.id === landing) tag.classList.add("landing");
        tag.dataset.i = idea.id;
        tag.setAttribute("aria-label", `${idea.title}, ${idea.score} out of 100, ${call(idea.score)[1]}`);
        tag.append(node("span", "num", idea.score), node("span", "ttl", idea.title));
      } else {
        tag.setAttribute("aria-label", `${k.name}, ${k.count} ${k.count === 1 ? "idea" : "ideas"}. Zoom in.`);
        tag.append(node("b", "", k.name), node("span", "", `${k.count} ${k.count === 1 ? "idea" : "ideas"}`));
      }
      tags.append(tag);
    });

    // Pointing at a branch, its leaves or its name lights all three and lets the rest step back.
    const glow = (k) => {
      view.classList.toggle("hot", k != null);
      for (const e of view.querySelectorAll("[data-k]")) e.classList.toggle("hot", e.dataset.k === k);
    };
    view.addEventListener("pointerover", (e) => e.pointerType !== "touch" && glow(e.target.closest?.("[data-k]")?.dataset.k));
    view.addEventListener("pointerleave", () => glow(null));
    return view;
  }

  function crumbs() {
    const nav = $("crumbs");
    nav.replaceChildren();
    const add = (label, p, now) => {
      const e = node(now ? "span" : "button", now ? "now" : "", label);
      if (!now) {
        e.type = "button";
        e.addEventListener("click", () => go(p));
      }
      nav.append(e);
    };
    add("All ideas", [], !path.length);
    path.forEach((name, i) => {
      nav.append(node("i", "", "/"));
      add(name, path.slice(0, i + 1), i === path.length - 1);
    });
    $("hint").textContent = ["Tap a branch to zoom in", "Tap a branch to read its ideas", "Tap an idea for its score"][path.length];
  }

  // ---- moving between views
  function draw(next, how) {
    const views = $("views"), W = views.clientWidth, H = views.clientHeight;
    const old = current, from = path;
    path = next;
    if (picked && find(picked)?.home.join("/") !== path.join("/")) picked = null;
    shown = model(path);
    const fresh = build(shown, W, H);
    box = `${W}x${H}`;
    crumbs();
    $("empty").hidden = data.trunks.length > 0;
    const ground = `50% ${H - 40}px`;
    if (still || !how || (!old && how !== "grow")) {
      views.replaceChildren(fresh);
    } else if (!old) {
      // First sight: the tree grows out of the ground.
      fresh.style.transformOrigin = ground;
      fresh.classList.add("from-small");
      views.append(fresh);
      void fresh.offsetWidth;
      fresh.classList.remove("from-small");
    } else if (how === "in") {
      // Zooming in: the old tree rushes past, aimed at the branch that was tapped. That branch grows as the new trunk.
      const aim = old.tips?.get(from.length ? `b:${next[0]}/${next[1]}` : `t:${next[0]}`);
      old.style.transformOrigin = aim ? `${aim.x}px ${aim.y}px` : "50% 40%";
      fresh.style.transformOrigin = ground;
      fresh.classList.add("from-small");
      views.append(fresh);
      void fresh.offsetWidth;
      old.classList.add("to-big");
      fresh.classList.remove("from-small");
      setTimeout(() => old.remove(), 720);
    } else {
      // Zooming out: the reverse. The tree we were on shrinks back into the branch it is.
      const aim = fresh.tips.get(next.length ? `b:${from[0]}/${from[1]}` : `t:${from[0]}`);
      old.style.transformOrigin = ground;
      fresh.style.transformOrigin = aim ? `${aim.x}px ${aim.y}px` : "50% 40%";
      fresh.classList.add("from-big");
      views.append(fresh);
      void fresh.offsetWidth;
      old.classList.add("to-small");
      fresh.classList.remove("from-big");
      setTimeout(() => old.remove(), 720);
    }
    current = fresh;
    sign();
    landing = null;
  }
  function route() {
    if (!data) return;
    const next = fit(fromHash());
    if (current && next.join("/") === path.join("/")) return;
    draw(next, next.length >= path.length ? "in" : "out");
  }
  const go = (p) => {
    if (toHash(p) === location.hash) return route();
    if (p.length) location.hash = toHash(p);
    else history.pushState(null, "", location.pathname + location.search), route();
  };
  addEventListener("hashchange", route);
  addEventListener("popstate", route);
  addEventListener("keydown", (e) => e.key === "Escape" && (picked ? pick(null) : path.length && go(path.slice(0, -1))));

  const ago = (iso) => {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return "Texted in just now";
    if (min < 60) return `Texted in ${min} min ago`;
    const h = Math.round(min / 60);
    return h < 24 ? `Texted in ${h} hr ago` : "Texted in earlier";
  };

  // One idea up close: the number, then the two ratings it came from.
  function sign() {
    const hit = picked && find(picked);
    $("thread").hidden = Boolean(hit);
    $("sign").hidden = !hit;
    if (!hit) return;
    const { idea, home } = hit;
    const [, name, band] = call(idea.score);
    $("sign").dataset.band = band;
    const fresh = idea.id === data.latest && Date.now() - Date.parse(idea.at) < 5 * 60_000;
    $("sign-when").textContent = fresh ? "Just landed" : idea.sample ? "" : ago(idea.at);
    $("sign-score").textContent = idea.score;
    $("sign-title").textContent = idea.title;
    $("sign-problem").textContent = idea.problem;
    $("sign-fix").textContent = idea.fix;
    $("sign-call").textContent = name;
    $("sign-where").textContent = home.join(" / ");
    const met = data.links.map(([a, b]) => (a === idea.id ? b : b === idea.id ? a : null)).map((id) => id && find(id)).find(Boolean);
    $("sign-near").textContent = met
      ? `Connected with the builder on "${met.idea.title}"`
      : idea.near
        ? `${idea.near} ${idea.near === 1 ? "builder is" : "builders are"} close to it`
        : "";
  }
  function pick(id) {
    picked = id;
    for (const e of current?.querySelectorAll("[data-k]") ?? []) e.classList.toggle("on", shown.kids[e.dataset.k]?.idea?.id === id && id != null);
    sign();
  }

  $("views").addEventListener("click", (e) => {
    if (e.target.closest(".view") !== current) return;
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (k != null) {
      const kid = shown.kids[k];
      return kid.idea ? pick(kid.idea.id === picked ? null : kid.idea.id) : go(kid.go);
    }
    if (e.target.closest(".up")) return go(path.slice(0, -1));
    if (picked) pick(null);
  });
  $("sign-close").addEventListener("click", () => pick(null));
  // The example texts are about one idea on the tree. This walks to it.
  $("see").addEventListener("click", () => {
    const all = data.trunks.flatMap((t) => t.branches.flatMap((b) => b.ideas));
    const hit = all.find((i) => i.sample && i.title === "Accessible entrances") ?? all.find((i) => i.score >= 70);
    if (!hit) return;
    picked = hit.id;
    const { home } = find(hit.id);
    if (home.join("/") === path.join("/")) pick(hit.id);
    else go(home);
    if (matchMedia("(max-width: 900px)").matches) $("stage").scrollIntoView({ block: "start", behavior: "smooth" });
  });

  function apply(next) {
    // The live feed repeats the current tree when it connects. Nothing changed, nothing to redraw.
    const raw = JSON.stringify(next);
    if (raw === seenRaw) return;
    seenRaw = raw;
    const ids = new Set(next.trunks.flatMap((t) => t.branches.flatMap((b) => b.ideas.map((i) => i.id))));
    const fresh = known && next.latest && !known.has(next.latest) ? next.latest : null;
    const first = !data;
    data = next;
    known = ids;
    document.title = "SlopStop";
    $("name").textContent = "SlopStop";
    $("tally").textContent = `${ids.size} ideas${next.connected ? `, ${next.connected} connected` : ""}`;
    if (picked && !ids.has(picked)) picked = null;
    if (fresh) {
      // A text just landed: go to its branch, grow its leaf and show its score.
      const { home } = find(fresh);
      picked = landing = fresh;
      closeJoin(); // whoever scanned the code has texted: give the side back
      const moved = home.join("/") !== path.join("/");
      draw(home, moved ? "in" : null);
      if (location.hash !== toHash(home)) history.replaceState(null, "", location.pathname + location.search + toHash(home));
      if (matchMedia("(max-width: 900px)").matches) $("stage").scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    draw(fit(first ? fromHash() : path), first ? "grow" : null);
  }

  // Redraw when the tree's box changes size (window resize, a phone rotating).
  let resizing;
  new ResizeObserver(() => {
    const v = $("views");
    if (!data || `${v.clientWidth}x${v.clientHeight}` === box) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => data && draw(path, null), 120);
  }).observe($("views"));

  // ---- live: the server pushes the tree the moment a text is scored
  // A browser only allows six open connections to one site, and every open tab holds one for live updates.
  // So a tab that is not being looked at lets go of its connection, and takes it back when it is shown again.
  let feed = null;
  function live() {
    if (feed || document.hidden) return;
    feed = new EventSource("/api/events");
    feed.onmessage = (e) => apply(JSON.parse(e.data));
    feed.onerror = () => {
      feed?.close();
      feed = null;
      setTimeout(live, 3000);
    };
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      feed?.close();
      feed = null;
    } else live();
  });
  fetch("/api/map", { cache: "no-store" })
    .then((res) => res.json())
    .then(apply)
    .catch(() => {})
    .finally(live);

  let joinTimer;
  function closeJoin() {
    clearTimeout(joinTimer);
    $("join-done").hidden = true;
    $("panel").classList.remove("joining");
  }

  // ---- spots: the line holds 100 people, so the page says how many are left
  async function spots() {
    const out = await fetch("/api/spots", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    const el = $("spots");
    if (!out || out.left === null || out.left === undefined) return void (el.hidden = true);
    el.innerHTML = out.left > 0 ? `<b>${out.left}</b> of ${out.cap} spots left` : `All ${out.cap} spots are taken.`;
    el.hidden = false;
  }
  spots();

  // ---- text it: register the number, then hand them Messages with the first text started
  const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);
  $("join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("join-note"), btn = $("join-go");
    note.className = "join-note";
    note.textContent = "";
    btn.disabled = true;
    try {
      const res = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: $("phone").value }) });
      const out = await res.json().catch(() => { throw new Error("Connection blip. Refresh the page and try again."); });
      if (!res.ok) throw new Error(out.error || "That didn't work. Try again.");
      spots();
      $("qr").innerHTML = out.qr;
      $("join-open").href = out.link;
      $("join-done").hidden = false;
      const touch = matchMedia("(pointer: coarse)").matches;
      $("qr").hidden = touch;
      $("join-how").innerHTML = touch ? "Opening Messages. Finish the sentence and send. Or text <b></b>" : "Scan it, or text <b></b>";
      $("join-how").querySelector("b").textContent = pretty(out.number);
      // On a shared laptop the next person should not see this number, and the code needs the room.
      $("phone").value = "";
      $("panel").classList.add("joining");
      clearTimeout(joinTimer);
      joinTimer = setTimeout(closeJoin, 4 * 60_000);
      if (touch) location.href = out.link;
    } catch (err) {
      note.className = "join-note bad";
      note.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
})();
