// The branch map. Each trunk is a trail, each branch a fork, each idea a waypoint.
// Height is the score, so the best idea on every branch is its summit.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  // Trail-blaze paint. Orange is kept for "you are here" and the button.
  const TRAILS = ["#7b2d8e", "#0b6e66", "#b57a00", "#a61e4d", "#5c4a1e", "#3d5a14", "#9c3b12", "#3a3a3a"];
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

  // Two short lines of title next to the score. The full title is on the sign.
  function wrap(title, first, rest) {
    const lines = [""];
    for (const w of title.split(" ")) {
      const cap = lines.length === 1 ? first : rest;
      const next = (lines.at(-1) + " " + w).trim();
      if (next.length <= cap || !lines.at(-1)) lines[lines.length - 1] = next;
      else if (lines.length < 2) lines.push(w);
      else {
        lines[1] = lines[1].slice(0, Math.max(1, rest - 1)).trimEnd() + "…";
        break;
      }
    }
    if (lines[1] && lines[1].length > rest) lines[1] = lines[1].slice(0, rest - 1).trimEnd() + "…";
    return lines;
  }

  function render() {
    const stage = $("stage");
    const svg = $("map");
    const lanes = [];
    data.trunks.forEach((t, ti) =>
      t.branches.forEach((b) => lanes.push({ ti, trunk: t.name, branch: b.name, ideas: b.ideas, color: TRAILS[ti % TRAILS.length] })),
    );
    $("empty").hidden = lanes.length > 0;

    const H = Math.max(stage.clientHeight, 540);
    const view = stage.clientWidth;
    box = `${view}x${stage.clientHeight}`;
    const small = phone();
    const padL = small ? 92 : 112, padR = small ? 12 : 16, top = 44, foot = 104, trunkGap = small ? 14 : 18;
    const gaps = Math.max(0, data.trunks.length - 1) * trunkGap;
    // On a phone exactly two lanes fit the screen, and the map pans sideways like a map should.
    const LW = small ? Math.floor((view - padL - 6) / 2) : Math.max(132, Math.min(210, (view - padL - padR - gaps) / Math.max(1, lanes.length)));
    const W = Math.max(view, padL + lanes.length * LW + gaps + padR);
    const y0 = H - foot;
    const y = (s) => top + (1 - s / 100) * (y0 - top);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    spots = new Map();

    // Terrain: a contour every 10 points, the way a topo map marks elevation.
    svg.append(el("rect", { class: "zone", x: 0, y: 0, width: W, height: y(70) }));
    for (let s = 0; s <= 100; s += 10) {
      let d = "";
      for (let x = 0; x <= W + 24; x += 24) {
        const wave = Math.sin(x / 97 + s) * 3.2 + Math.sin(x / 41 + s * 1.7) * 1.6;
        d += `${x ? "L" : "M"}${x},${(y(s) + wave).toFixed(1)}`;
      }
      svg.append(el("path", { class: `contour${s % 20 ? "" : " index"}`, d }));
    }
    // The two lines that turn a score into a decision, and the scale that names them.
    const gutter = $("gutter");
    gutter.replaceChildren();
    const mark = (s, text, call) => {
      const m = document.createElement("span");
      m.textContent = text;
      m.style.top = `${y(s)}px`;
      if (call) m.className = "call";
      gutter.append(m);
    };
    for (const s of [100, 80, 60, 20, 0]) mark(s, s);
    for (const [s, name] of CALLS.slice(0, 2)) {
      svg.append(el("path", { class: "bar", d: `M0,${y(s)} H${W}` }));
      mark(s, `${s} ${name}`, true);
    }

    // Lanes: one per branch, grouped by trunk.
    let cursor = padL;
    lanes.forEach((lane, n) => {
      if (n && lane.ti !== lanes[n - 1].ti) cursor += trunkGap;
      lane.x = cursor + 14;
      cursor += LW;
      // Highest score on top. Where two would overlap, nudge them apart but keep the order.
      const gap = 36;
      const pts = [...lane.ideas].sort((a, b) => b.score - a.score || a.at.localeCompare(b.at)).map((idea) => ({ idea, y: y(idea.score) }));
      for (let i = 1; i < pts.length; i++) pts[i].y = Math.max(pts[i].y, pts[i - 1].y + gap);
      const floor = y0 - 16;
      for (let i = pts.length - 1; i >= 0; i--) pts[i].y = Math.min(pts[i].y, i === pts.length - 1 ? floor : pts[i + 1].y - gap);
      lane.pts = pts;
    });

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
        names.append(el("text", { class: "branch-name", x: lane.x + 10, y: y0 + 26, fill: color, style: `fill:${color}` }, lane.branch));
        for (const p of lane.pts) spots.set(p.idea.id, { x: lane.x, y: p.y, color, idea: p.idea, trunk: lane.trunk, branch: lane.branch });
      }
      names.append(el("rect", { x: tx - 6, y: ty - 4, width: 12, height: 20, rx: 2.5, fill: color, stroke: "var(--paper)", "stroke-width": 2 }));
      names.append(el("text", { class: "trunk-name", x: tx + 14, y: ty + 12 }, t.name));
    });
    svg.append(trails);

    // A dotted line between two ideas whose builders said yes to each other.
    for (const [a, b] of data.links) {
      const p = spots.get(a), q = spots.get(b);
      if (!p || !q) continue;
      const same = Math.abs(p.x - q.x) < 10;
      const cx = same ? p.x - 46 : (p.x + q.x) / 2;
      const cy = same ? (p.y + q.y) / 2 : Math.min(p.y, q.y) - 46;
      svg.append(el("path", { class: "link", d: `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}` }));
    }
    svg.append(names);

    // Waypoints. A peak for anything at 70 or above, a dot for the rest. Hollow means sample.
    const first = Math.floor((LW - 64) / 7.1), rest = Math.floor((LW - 26) / 7.1);
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
      g.append(el("rect", { class: "hit", x: x - 13, y: py - 17, width: LW - 4, height: 36 }));
      g.append(el("circle", { class: "halo", cx: x, cy: py, r: 13 }));
      const paint = idea.sample ? { fill: "var(--sheet)", style: `stroke:${color}` } : { fill: color };
      g.append(
        idea.score >= 70
          ? el("path", { class: "dot", d: `M${x},${py - 9.5} L${x + 9},${py + 6.5} L${x - 9},${py + 6.5} Z`, "stroke-linejoin": "round", ...paint })
          : el("circle", { class: "dot", cx: x, cy: py, r: 6.5, ...paint }),
      );
      const [l1, l2] = wrap(idea.title, first, rest);
      const text = el("text", { x: x + 15, y: py + 6 });
      text.append(el("tspan", { class: "num" }, idea.score), el("tspan", { class: "ttl", dx: 6 }, l1));
      if (l2) text.append(el("tspan", { class: "ttl", x: x + 15, dy: 15 }, l2));
      g.append(text);
      svg.append(g);
    }

    // You are here: the newest idea that was texted in.
    const here = spots.get(data.latest);
    if (here) {
      svg.append(el("circle", { class: "here", cx: here.x, cy: here.y, r: 12 }));
      svg.append(el("circle", { class: "here-core", cx: here.x, cy: here.y, r: 13 }));
    }
    sign();
    landing = null;
    opening = false;
  }

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
    $("thread").hidden = Boolean(data.latest) && !phone();
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
    const samples = next.trunks.some((t) => t.branches.some((b) => b.ideas.some((i) => i.sample)));
    $("tally").textContent = next.ideas ? `${next.ideas} texted in${next.connected ? `, ${next.connected} connected` : ""}` : "";
    $("key-sample").hidden = !samples;
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
    if (s) stage.scrollTo({ left: Math.max(0, phone() ? s.x - 108 : s.x - stage.clientWidth / 2), behavior: fresh ? "smooth" : "auto" });
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
  fetch("/api/map", { cache: "no-store" })
    .then((r) => r.json())
    .then(apply)
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
      $("join-how").innerHTML = touch ? "Opening Messages. Finish the sentence and send. Or text <b></b>" : "Scan it with your phone, or text <b></b>";
      $("join-how").querySelector("b").textContent = pretty(out.number);
      if (touch) location.href = out.link;
    } catch (err) {
      note.className = "join-note bad";
      note.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });
})();
