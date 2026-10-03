// The branch map. Each trunk is a trail, each branch a fork, each idea a waypoint.
// Height is the score, so every branch is a mountain and its best idea is the summit.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  // Trail-blaze paint. Orange is kept for "you are here", the summits and the button.
  const TRAILS = ["#7b2d8e", "#0b6e66", "#8a5a00", "#a61e4d", "#5c4a1e", "#3d5a14", "#9c3b12", "#3a3a3a"];
  const CALLS = [
    [70, "build it"],
    [40, "sharpen it"],
    [0, "drop it or flip it"],
  ];
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };
  const phone = () => matchMedia("(max-width: 820px)").matches;

  let data = null;
  let known = null; // ids already drawn, so only a real arrival animates
  let picked = null; // the waypoint someone tapped; null means follow the newest
  let landing = null;
  let box = ""; // the map's size at the last draw, so only a real size change redraws
  let seenRaw = "";
  let opening = true; // the first paint grows the trails from the ground up, once
  let spots = new Map(); // id -> { x, y, color, idea, trunk, branch }

  // Titles are measured, not guessed, so a label is only cut when it truly does not fit.
  const ruler = document.createElement("canvas").getContext("2d");
  const span = (text, px, weight) => {
    ruler.font = `${weight} ${px}px Overpass, "Helvetica Neue", Arial, sans-serif`;
    return ruler.measureText(text).width;
  };
  function wrap(title, first, rest, px) {
    const fits = (s, n) => span(s, px, 700) <= (n ? rest : first);
    const lines = [""];
    for (const w of title.split(" ")) {
      const n = lines.length - 1;
      const next = (lines[n] + " " + w).trim();
      if (fits(next, n) || !lines[n]) lines[n] = next;
      else if (lines.length < 2) lines.push(w);
      else {
        lines[1] += " " + w;
        break;
      }
    }
    if (lines[1]) while (lines[1].length > 2 && !fits(lines[1], 1)) lines[1] = lines[1].replace(/.…?$/, "").trimEnd() + "…";
    return lines;
  }

  // One side of a mountain: a near-straight flank that eases into the valley.
  const flank = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    return dy > 0
      ? `C${a.x + dx * 0.34},${a.y + dy * 0.42} ${a.x + dx * 0.66},${a.y + dy * 0.9} ${b.x},${b.y}`
      : `C${a.x + dx * 0.34},${a.y + dy * 0.1} ${a.x + dx * 0.66},${a.y + dy * 0.58} ${b.x},${b.y}`;
  };

  function render() {
    const stage = $("stage");
    const svg = $("map");
    const lanes = [];
    data.trunks.forEach((t, ti) =>
      t.branches.forEach((b) => lanes.push({ ti, trunk: t.name, branch: b.name, ideas: b.ideas, color: TRAILS[ti % TRAILS.length] })),
    );
    $("empty").hidden = lanes.length > 0;

    const small = phone();
    const H = Math.max(stage.clientHeight, 540);
    const view = stage.clientWidth;
    box = `${view}x${stage.clientHeight}`;
    // Sized to be read standing a meter from a laptop. A phone is held closer, so it can run smaller.
    const type = small ? { num: 20, ttl: 14.5, line: 16, gap: 40 } : { num: 23, ttl: 16, line: 18, gap: 46 };
    const padL = small ? 100 : 146, padR = small ? 12 : 16, top = 46, foot = 104, trunkGap = small ? 14 : 18;
    const gaps = Math.max(0, data.trunks.length - 1) * trunkGap;
    // On a phone two lanes fit and a sliver of the third shows, so it is plain the map pans sideways.
    const LW = small ? Math.floor((view - padL) / 2.12) : Math.max(150, Math.min(214, (view - padL - padR - gaps) / Math.max(1, lanes.length)));
    const W = Math.max(view, padL + lanes.length * LW + gaps + padR);
    const y0 = H - foot;
    const y = (s) => top + (1 - s / 100) * (y0 - top);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    spots = new Map();

    // Lanes: one per branch, grouped by trunk.
    let cursor = padL;
    lanes.forEach((lane, n) => {
      if (n && lane.ti !== lanes[n - 1].ti) cursor += trunkGap;
      lane.x = cursor + 14;
      cursor += LW;
      // Highest score on top. Where two would overlap, nudge them apart but keep the order.
      const pts = [...lane.ideas].sort((a, b) => b.score - a.score || a.at.localeCompare(b.at)).map((idea) => ({ idea, y: y(idea.score) }));
      for (let i = 1; i < pts.length; i++) pts[i].y = Math.max(pts[i].y, pts[i - 1].y + type.gap);
      const floor = y0 - 20;
      for (let i = pts.length - 1; i >= 0; i--) pts[i].y = Math.min(pts[i].y, i === pts.length - 1 ? floor : pts[i + 1].y - type.gap);
      lane.pts = pts;
      lane.peak = (pts[0]?.y ?? y0 - 24) - 24;
    });

    // The land. One ridge: a summit over each branch's best idea, a valley between branches,
    // and a deeper pass between trunks.
    let ridge = `M0,${y0}`;
    if (lanes.length) {
      let at = { x: Math.max(0, lanes[0].x - LW * 0.7), y: y0 };
      ridge += ` L${at.x},${at.y}`;
      lanes.forEach((lane, i) => {
        if (i) {
          const prev = lanes[i - 1];
          const high = Math.max(prev.peak, lane.peak);
          const pass = { x: prev.x + (lane.x - prev.x) * 0.56, y: high + (y0 - high) * (prev.ti === lane.ti ? 0.24 : 0.5) };
          ridge += ` ${flank(at, pass)}`;
          at = pass;
        }
        // A small rounded cap, so a summit reads as rock and not as a spike.
        const cap = Math.min(11, LW * 0.07);
        ridge += ` ${flank(at, { x: lane.x - cap, y: lane.peak + 8 })} Q${lane.x},${lane.peak - 4} ${lane.x + cap},${lane.peak + 8}`;
        at = { x: lane.x + cap, y: lane.peak + 8 };
      });
      const end = { x: Math.min(W, at.x + LW * 0.95), y: y0 };
      ridge += ` ${flank(at, end)} L${W},${y0}`;
    } else ridge += ` L${W},${y0}`;
    const land = `${ridge} L${W},${y0 + 14} L0,${y0 + 14} Z`;

    // In the open sky, the two lines that turn a score into a decision.
    for (const [s] of CALLS.slice(0, 2)) svg.append(el("path", { class: "bar", d: `M0,${y(s)} H${W}` }));

    const defs = el("defs");
    const clip = el("clipPath", { id: "land" });
    clip.append(el("path", { d: land }));
    defs.append(clip);
    svg.append(defs);
    svg.append(el("path", { class: "land", d: land }));
    // Elevation tints, the way a relief map does it: lowland, the middle band, and summits past 70 in orange.
    const relief = el("g", { "clip-path": "url(#land)" });
    relief.append(el("rect", { class: "mid", x: 0, y: 0, width: W, height: y(40) }));
    relief.append(el("rect", { class: "high", x: 0, y: 0, width: W, height: y(70) }));
    for (let s = 0; s <= 100; s += 10) {
      let d = "";
      for (let x = 0; x <= W + 24; x += 24) {
        const wave = Math.sin(x / 97 + s) * 3.2 + Math.sin(x / 41 + s * 1.7) * 1.6;
        d += `${x ? "L" : "M"}${x},${(y(s) + wave).toFixed(1)}`;
      }
      relief.append(el("path", { class: `contour${s % 20 ? "" : " index"}`, d }));
    }
    for (const [s] of CALLS.slice(0, 2)) relief.append(el("path", { class: "band-edge", d: `M0,${y(s)} H${W}` }));
    svg.append(relief);
    svg.append(el("path", { class: "ridge", d: ridge }));

    // The scale that names the lines. It stays put while the map pans under it.
    const gutter = $("gutter");
    gutter.replaceChildren();
    const mark = (s, text, call) => {
      const m = document.createElement("span");
      m.textContent = text;
      m.style.top = `${y(s)}px`;
      if (call) m.className = "call";
      gutter.append(m);
    };
    for (const s of small ? [100, 0] : [100, 80, 60, 20, 0]) mark(s, s);
    for (const [s, name] of CALLS.slice(0, 2)) mark(s, `${s} ${name}`, true);

    // Trails. Each trunk starts at its own blaze and forks into its branches.
    const trails = el("g");
    const names = el("g");
    data.trunks.forEach((t, ti) => {
      const mine = lanes.filter((l) => l.ti === ti);
      const color = mine[0].color;
      const tx = mine.reduce((sum, l) => sum + l.x, 0) / mine.length;
      const ty = y0 + 72;
      for (const lane of mine) {
        let d = `M${tx},${ty} C${tx},${ty - 24} ${lane.x},${y0 + 56} ${lane.x},${y0 + 30}`;
        let px = lane.x, py = y0 + 30;
        [...lane.pts].reverse().forEach((p, i) => {
          const mid = (py + p.y) / 2;
          const bend = (i % 2 ? -1 : 1) * Math.min(8, Math.abs(py - p.y) / 5);
          d += ` C${px + bend},${mid} ${lane.x - bend},${mid} ${lane.x},${p.y}`;
          px = lane.x;
          py = p.y;
        });
        const grow = opening ? { pathLength: 1, style: `animation-delay:${ti * 110}ms` } : {};
        trails.append(el("path", { class: `casing${opening ? " grow" : ""}`, d, ...grow }), el("path", { class: `trail${opening ? " grow" : ""}`, d, stroke: color, ...grow }));
        names.append(el("text", { class: "branch-name", x: lane.x + 10, y: y0 + 34, style: `fill:${color}` }, lane.branch));
        for (const p of lane.pts) spots.set(p.idea.id, { x: lane.x, y: p.y, color, idea: p.idea, trunk: lane.trunk, branch: lane.branch });
      }
      names.append(el("rect", { x: tx - 6, y: ty - 4, width: 12, height: 20, rx: 2.5, fill: color, stroke: "var(--paper)", "stroke-width": 2 }));
      names.append(el("text", { class: "trunk-name", x: tx + 14, y: ty + 13 }, t.name));
    });
    svg.append(trails);

    // A dotted line between two ideas whose builders said yes to each other.
    for (const [a, b] of data.links) {
      const p = spots.get(a), q = spots.get(b);
      if (!p || !q) continue;
      const same = Math.abs(p.x - q.x) < 10;
      const cx = same ? p.x - 46 : (p.x + q.x) / 2;
      const cy = same ? (p.y + q.y) / 2 : Math.min(p.y, q.y) - 46;
      const d = `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`;
      svg.append(el("path", { class: "link-casing", d }), el("path", { class: "link", d }));
    }
    svg.append(names);

    // Waypoints. Solid was texted in, hollow is a sample.
    for (const [id, s] of spots) {
      const { idea, x, y: py, color } = s;
      const g = el("g", {
        class: `wp${idea.sample ? " sample" : ""}${id === shown() ? " on" : ""}${id === landing ? " landing" : ""}${opening ? " rise" : ""}`,
        // Waypoints appear as the trail reaches them: lowest first.
        ...(opening ? { style: `animation-delay:${Math.round(250 + ((y0 - py) / (y0 - top)) * 900)}ms` } : {}),
        tabindex: 0,
        role: "button",
        "aria-label": `${idea.title}, ${idea.score} out of 100`,
        "data-id": id,
      });
      g.append(el("rect", { class: "hit", x: x - 14, y: py - 20, width: LW - 4, height: type.gap - 2 }));
      g.append(el("circle", { class: "halo", cx: x, cy: py, r: 14 }));
      g.append(el("circle", { class: "dot", cx: x, cy: py, r: 7.5, ...(idea.sample ? { fill: "var(--sheet)", style: `stroke:${color}` } : { fill: color }) }));
      const numW = span(String(idea.score), type.num, 900);
      const [l1, l2] = wrap(idea.title, LW - 16 - numW - 7 - 8, LW - 16 - 8, type.ttl);
      const text = el("text", { x: x + 16, y: py + type.num * 0.34 });
      text.append(el("tspan", { class: "num", "font-size": type.num }, idea.score), el("tspan", { class: "ttl", dx: 7, "font-size": type.ttl }, l1));
      if (l2) text.append(el("tspan", { class: "ttl", x: x + 16, dy: type.line, "font-size": type.ttl }, l2));
      g.append(text);
      svg.append(g);
    }

    // You are here: the newest idea that was texted in. Before anyone has, the idea from the example texts.
    const here = spots.get(marked());
    if (here) {
      svg.append(el("circle", { class: "here", cx: here.x, cy: here.y, r: 13 }));
      svg.append(el("circle", { class: "here-casing", cx: here.x, cy: here.y, r: 14 }));
      svg.append(el("circle", { class: "here-core", cx: here.x, cy: here.y, r: 14 }));
    }
    sign();
    landing = null;
    opening = false;
  }

  /** The example texts in the side panel are about this sample, so the two point at each other. */
  const example = () => [...spots.values()].find((s) => s.idea.sample && /^Invoice chaser/.test(s.idea.title))?.idea.id;
  const marked = () => data?.latest ?? example();
  const shown = () => (picked && spots.has(picked) ? picked : data?.latest);

  const ago = (iso) => {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return "Texted in just now";
    if (min < 60) return `Texted in ${min} min ago`;
    const h = Math.round(min / 60);
    return h < 24 ? `Texted in ${h} hr ago` : "Texted in earlier";
  };

  // The sign: one idea, read like a trail marker.
  function sign() {
    const s = spots.get(shown());
    const box = $("sign");
    $("thread").hidden = Boolean(s);
    // On a phone the sign covers part of the map, so it only opens when asked.
    if (!s || (phone() && !picked)) return (box.hidden = true);
    const { idea } = s;
    box.hidden = false;
    const fresh = idea.id === data.latest && Date.now() - Date.parse(idea.at) < 5 * 60_000;
    $("sign-when").textContent = idea.sample ? "Sample idea" : fresh ? "Just landed" : ago(idea.at);
    $("sign-score").textContent = idea.score;
    $("sign-title").textContent = idea.title;
    $("sign-problem").textContent = idea.problem;
    $("sign-fix").textContent = idea.fix;
    $("sign-call").textContent = CALLS.find(([min]) => idea.score >= min)[1];
    $("sign-where").textContent = `${s.trunk}, ${s.branch}`;
    $("sign-blaze").style.background = s.color;
    $("sign-near").textContent = idea.near ? `${idea.near} ${idea.near === 1 ? "builder is" : "builders are"} close to it` : "";
  }

  function apply(next) {
    // The live feed repeats the current map when it connects. Nothing changed, nothing to redraw.
    const raw = JSON.stringify(next);
    if (raw === seenRaw) return;
    seenRaw = raw;
    const ids = new Set(next.trunks.flatMap((t) => t.branches.flatMap((b) => b.ideas.map((i) => i.id))));
    const fresh = known && next.latest && !known.has(next.latest) ? next.latest : null;
    data = next;
    known = ids;
    document.title = next.name;
    $("name").textContent = next.name;
    $("tally").textContent = next.ideas ? `${next.ideas} texted in${next.connected ? `, ${next.connected} connected` : ""}` : "";
    $("key-sample").hidden = !next.trunks.some((t) => t.branches.some((b) => b.ideas.some((i) => i.sample)));
    if (fresh) {
      picked = phone() ? fresh : null;
      landing = fresh;
    }
    const firstPaint = !$("map").childElementCount;
    render();
    // Keep the newest idea in view: on first paint, and whenever one lands.
    const s = spots.get(fresh || (firstPaint && next.latest));
    const stage = $("stage");
    // On a phone, the idea's own lane becomes the first one after the scale. On a wide screen, center it.
    if (s) stage.scrollTo({ left: Math.max(0, phone() ? s.x - 114 : s.x - stage.clientWidth / 2), behavior: fresh ? "smooth" : "auto" });
  }

  // ---- picking a waypoint
  const pick = (id) => {
    picked = id;
    render();
  };
  $("map").addEventListener("click", (e) => {
    const wp = e.target.closest(".wp");
    pick(wp ? wp.dataset.id : null);
  });
  $("map").addEventListener("keydown", (e) => {
    const wp = e.target.closest(".wp");
    if (wp && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pick(wp.dataset.id);
      $("map").querySelector(`[data-id="${wp.dataset.id}"]`)?.focus();
    }
  });
  $("sign-close").addEventListener("click", () => pick(null));

  // Redraw whenever the map's own box changes size (window resize, a toolbar appearing, the phone rotating).
  let resizing;
  new ResizeObserver(() => {
    const stage = $("stage");
    if (!data || `${stage.clientWidth}x${stage.clientHeight}` === box) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => data && render(), 120);
  }).observe($("stage"));

  // ---- live: the server pushes the map the moment a text is scored
  function live() {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => apply(JSON.parse(e.data));
    es.onerror = () => {
      es.close();
      setTimeout(live, 3000);
    };
  }
  // Labels are measured in the real typeface, so wait for it (briefly) before the first draw.
  const fonts = Promise.race([document.fonts?.load('700 16px "Overpass"').then(() => document.fonts.load('900 23px "Overpass"')), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  Promise.all([fetch("/api/map", { cache: "no-store" }).then((r) => r.json()), fonts])
    .then(([map]) => apply(map))
    .catch(() => {})
    .finally(live);

  // ---- text it: register the number, then hand them Messages with the first text started
  const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);
  $("join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("join-note"), go = $("join-go");
    note.className = "join-note";
    note.textContent = "";
    go.disabled = true;
    try {
      const res = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: $("phone").value }) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "That didn't work. Try again.");
      $("qr").innerHTML = out.qr;
      $("join-open").href = out.link;
      $("join-done").hidden = false;
      const touch = matchMedia("(pointer: coarse)").matches;
      $("qr").hidden = touch;
      $("join-how").innerHTML = touch ? "Opening Messages. Finish the sentence and send. Or text <b></b>" : "Scan it, or text <b></b>";
      $("join-how").querySelector("b").textContent = pretty(out.number);
      // On a shared laptop the next person should not see this number, and the code needs the room.
      $("phone").value = "";
      document.querySelector(".panel").classList.add("joining");
      if (touch) location.href = out.link;
    } catch (err) {
      note.className = "join-note bad";
      note.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });
})();
