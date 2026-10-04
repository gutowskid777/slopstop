// The idea map, at night. The card in the middle is where the texts come in. From it, wires of light run out
// to every category and on to every smaller one, the way signals run through a net of neurons. Each idea is
// a dot at the end of its wire. A gold wire carries an idea worth building.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const CALLS = [[70, "build it", "build"], [40, "sharpen it", "sharp"], [0, "drop it or flip it", "drop"]];
  const band = (s) => CALLS.find(([min]) => s >= min)[2];
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
  const r = (n) => Math.round(n * 10) / 10;
  const tall = () => matchMedia("(max-width: 1099px)").matches;
  // ?static draws the finished map with no motion (screenshots, slow machines).
  const still = new URLSearchParams(location.search).has("static") || matchMedia("(prefers-reduced-motion: reduce)").matches;

  let data = null, known = null, seenRaw = "", box = "";
  let picked = null; // the category someone tapped: "trunk/branch"
  let fresh = null; // the idea that just landed
  let opening = !still;
  const seat = new Map(), rank = new Map();
  const place = (key) => rank.get(key) ?? rank.set(key, rank.size).get(key);

  // ---- the sky: stars drawn once, a few of them breathing
  function sky() {
    const c = $("sky"), d = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * d;
    c.height = innerHeight * d;
    const g = c.getContext("2d");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 260; i++) {
      const big = rnd() < 0.08;
      g.globalAlpha = 0.25 + rnd() * 0.65;
      g.fillStyle = rnd() < 0.3 ? "#b9c9ff" : "#ffffff";
      g.beginPath();
      g.arc(rnd() * c.width, rnd() * c.height, (big ? 1.5 : 0.4 + rnd() * 0.7) * d, 0, 7);
      g.fill();
    }
  }
  sky();
  addEventListener("resize", sky);

  function tree() {
    const trunks = data.trunks.map((t) => {
      const branches = t.branches.map((b) => {
        const ideas = [...b.ideas].sort((a, c) => c.score - a.score);
        return { name: b.name, key: `${t.name}/${b.name}`, ideas, band: band(ideas[0].score) };
      }).sort((a, c) => c.ideas.length - a.ideas.length);
      return { name: t.name, branches };
    }).sort((a, c) => c.branches.length - a.branches.length);
    for (const t of trunks) {
      place(`t:${t.name}`);
      for (const b of t.branches) place(`b:${b.key}`);
      t.branches.sort((a, c) => place(`b:${a.key}`) - place(`b:${c.key}`));
    }
    return trunks.sort((a, c) => place(`t:${a.name}`) - place(`t:${c.name}`));
  }

  const bend = (x1, y1, x2, y2) => `C${r((x1 + x2) / 2)},${r(y1)} ${r((x1 + x2) / 2)},${r(y2)} ${r(x2)},${r(y2)}`;
  function row(b, t, side, order) {
    const e = node("button", `row ${side} ${b.band}${b.key === picked ? " on" : ""}${opening ? " rise" : ""}`);
    e.type = "button";
    if (opening) e.style.animationDelay = `${600 + order * 14}ms`;
    e.dataset.b = b.key;
    e.dataset.t = t.name;
    e.setAttribute("aria-label", `${b.name}, ${b.ideas.length} ideas, best ${b.ideas[0].score}`);
    const dots = node("span", "dots");
    for (const i of b.ideas.slice(0, 12)) dots.append(node("i", `${band(i.score)}${i.sample ? "" : " real"}${i.id === data.latest ? " here" : ""}`));
    e.append(node("span", "node"), node("b", "", b.name), dots);
    $("nodes").append(e);
    return e;
  }
  function wire(d, b, t, order) {
    const moving = !still && (opening || (fresh && b.ideas.some((i) => i.id === fresh)));
    const p = svg("path", { class: `w ${b.band}${moving ? " grow" : ""}`, d, "data-b": b.key, "data-t": t.name });
    if (moving) {
      p.setAttribute("pathLength", 1);
      if (opening) p.style.animationDelay = `${order * 12}ms`;
    }
    $("wires").append(p);
    // A signal runs down some of the wires, and down the one a new text just took.
    if (!still && (order % 4 === 1 || (fresh && b.ideas.some((i) => i.id === fresh)))) {
      const dot = svg("circle", { class: "pulse", r: 2.1 });
      const run = svg("animateMotion", { dur: `${3.2 + (order % 5) * 0.7}s`, begin: `${1.2 + (order % 7) * 0.6}s`, repeatCount: "indefinite", path: d });
      dot.append(run);
      $("wires").append(dot);
    }
  }

  const BG = 0, TG = 0.9;
  const height = (side) => side.reduce((s, t) => s + t.branches.length, 0) + Math.max(0, side.length - 1) * TG;
  function drawWide(trunks, canvas, stage) {
    const W = stage.clientWidth, view = stage.clientHeight;
    const sides = [[], []];
    for (const t of trunks) {
      if (!seat.has(t.name)) seat.set(t.name, height(sides[1]) < height(sides[0]) ? 1 : 0);
      sides[seat.get(t.name)].push(t);
    }
    const rows = Math.max(height(sides[0]), height(sides[1]), 1), pad = 20;
    const rowH = Math.max(17, Math.min(30, (view - pad * 2) / rows));
    const H = Math.max(view, Math.ceil(rows * rowH + pad * 2));
    canvas.style.height = `${H}px`;
    canvas.style.setProperty("--row", `${r(rowH)}px`);
    canvas.style.setProperty("--fs", `${r(Math.max(12, Math.min(16, rowH * 0.66)))}px`);
    canvas.style.setProperty("--tf", `${r(Math.max(13.5, Math.min(18, rowH * 0.74)))}px`);
    $("wires").setAttribute("width", W);
    $("wires").setAttribute("height", H);
    const c = canvas.getBoundingClientRect(), h = $("hub").getBoundingClientRect();
    const hub = { l: h.left - c.left, r: h.right - c.left, y: h.top - c.top + h.height / 2, h: h.height };
    sides.forEach((side, s) => {
      const dir = s ? 1 : -1, edge = s ? hub.r : hub.l;
      const room = (s ? W - hub.r : hub.l) - 16;
      const run = Math.max(120, room - Math.min(330, room * 0.56));
      const x = [-8 / run, 0.36, 0.66, 1].map((f) => edge + dir * f * run);
      const n = side.reduce((sum, t) => sum + t.branches.length, 0);
      const gap = Math.max(1.6, Math.min(3.4, (hub.h - 40) / Math.max(1, n)));
      let y = (H - height(side) * rowH) / 2, i = 0;
      side.forEach((t, ti) => {
        if (ti) y += TG * rowH;
        const ty = y + (t.branches.length * rowH) / 2;
        t.branches.forEach((b, j) => {
          const by = y + rowH / 2;
          const ya = hub.y + (i - (n - 1) / 2) * gap, yb = ty + (j - (t.branches.length - 1) / 2) * gap;
          wire(`M${r(x[0])},${r(ya)} ${bend(x[0], ya, x[1], yb)} H${r(x[2])} ${bend(x[2], yb, x[3], by)}`, b, t, i);
          const e = row(b, t, s ? "r" : "l", i);
          e.style.top = `${r(by)}px`;
          if (s) e.style.left = `${r(x[3] - 4.5)}px`;
          else e.style.right = `${r(W - x[3] - 4.5)}px`;
          y += rowH;
          i++;
        });
        const chip = node("button", `chip${opening ? " rise" : ""}`, t.name);
        chip.type = "button";
        if (opening) chip.style.animationDelay = "300ms";
        chip.dataset.t = t.name;
        chip.dataset.chip = "1";
        chip.style.left = `${r((x[1] + x[2]) / 2)}px`;
        chip.style.top = `${r(ty)}px`;
        $("nodes").append(chip);
      });
    });
  }
  function drawTall(trunks, canvas, stage) {
    const W = stage.clientWidth, rowH = 34;
    canvas.style.setProperty("--row", `${rowH}px`);
    canvas.style.setProperty("--fs", "16px");
    canvas.style.setProperty("--tf", "19px");
    let y = 6, i = 0;
    for (const t of trunks) {
      const chip = node("button", "chip", t.name);
      chip.type = "button";
      chip.dataset.t = t.name;
      chip.dataset.chip = "1";
      chip.style.left = "16px";
      chip.style.top = `${y + 15}px`;
      $("nodes").append(chip);
      y += 36;
      const top = y - 6;
      for (const b of t.branches) {
        const by = y + rowH / 2;
        wire(`M26,${top} V${by - 10} Q26,${by} 36,${by} H44`, b, t, i);
        const e = row(b, t, "r", i);
        e.style.top = `${by}px`;
        e.style.left = "39.5px";
        y += rowH;
        i++;
      }
      y += 18;
    }
    canvas.style.height = `${y}px`;
    $("wires").setAttribute("width", W);
    $("wires").setAttribute("height", y);
  }

  const sizeKey = () => (tall() ? `tall/${$("stage").clientWidth}` : `${$("stage").clientWidth}x${$("stage").clientHeight}/${$("hub").offsetHeight}`);
  function render() {
    const trunks = tree();
    $("empty").hidden = trunks.length > 0;
    $("nodes").replaceChildren();
    $("wires").replaceChildren();
    box = sizeKey();
    $("canvas").classList.toggle("tall", tall());
    (tall() ? drawTall : drawWide)(trunks, $("canvas"), $("stage"));
    sign();
    rest();
    fresh = null;
    opening = false;
  }

  // ---- lighting: one category or one whole trunk stands out, the rest of the net dims
  function light(key) {
    const stage = $("stage");
    stage.classList.toggle("focus", Boolean(key));
    for (const e of stage.querySelectorAll("[data-t]")) {
      const d = e.dataset;
      e.classList.toggle("lit", Boolean(key) && (key[0] === "t" ? d.t === key.slice(2) : d.b === key.slice(2) || (d.chip && d.t === key.slice(2).split("/")[0])));
    }
  }
  const rest = () => light(picked ? `b:${picked}` : null);
  const keyOf = (n) => (n.dataset.chip ? `t:${n.dataset.t}` : `b:${n.dataset.b}`);

  // One category up close: its ideas, best first, each with its score.
  function sign() {
    const hit = picked && data.trunks.flatMap((t) => t.branches.map((b) => ({ t, b }))).find(({ t, b }) => `${t.name}/${b.name}` === picked);
    $("thread").hidden = Boolean(hit);
    $("sign").hidden = !hit;
    if (!hit) return;
    $("sign-when").textContent = hit.t.name;
    $("sign-title").textContent = hit.b.name;
    const list = $("sign-list");
    list.replaceChildren();
    for (const i of [...hit.b.ideas].sort((a, c) => c.score - a.score)) {
      const li = node("li", `${band(i.score)}${i.sample ? "" : " real"}${i.id === data.latest && Date.now() - Date.parse(i.at) < 5 * 60_000 ? " new" : ""}`);
      li.append(node("b", "", i.score), node("span", "", i.title));
      if (!i.sample) li.append(node("small", "", li.classList.contains("new") ? "just landed" : "texted in"));
      li.title = `problem ${i.problem}, fix ${i.fix}`;
      list.append(li);
    }
  }
  function pick(key) {
    picked = key;
    for (const e of $("nodes").querySelectorAll(".row")) e.classList.toggle("on", e.dataset.b === key);
    sign();
    rest();
  }

  function apply(next) {
    const raw = JSON.stringify(next);
    if (raw === seenRaw) return;
    seenRaw = raw;
    const ids = new Set(next.trunks.flatMap((t) => t.branches.flatMap((b) => b.ideas.map((i) => i.id))));
    const landed = known && next.latest && !known.has(next.latest) ? next.latest : null;
    data = next;
    known = ids;
    document.title = next.name;
    $("name").textContent = next.name;
    const branches = next.trunks.reduce((s, t) => s + t.branches.length, 0);
    $("tally").textContent = next.ideas ? `${next.ideas} texted in${next.connected ? `, ${next.connected} connected` : ""}` : "";
    $("tally").title = `${ids.size} ideas across ${branches} categories`;
    if (landed) {
      // A text just landed: its wire draws in, a signal runs down it, and its category opens.
      fresh = landed;
      for (const t of next.trunks) for (const b of t.branches) if (b.ideas.some((i) => i.id === landed)) picked = `${t.name}/${b.name}`;
      closeJoin();
    }
    render();
    if (landed && tall()) $("nodes").querySelector(`.row.on`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  $("nodes").addEventListener("pointerover", (e) => {
    const n = e.pointerType === "touch" ? null : e.target.closest?.("[data-t]");
    if (n) light(keyOf(n));
  });
  $("nodes").addEventListener("pointerout", (e) => e.pointerType !== "touch" && rest());
  $("stage").addEventListener("click", (e) => {
    const n = e.target.closest(".row");
    pick(n && n.dataset.b !== picked ? n.dataset.b : null);
  });
  $("sign-close").addEventListener("click", () => pick(null));
  addEventListener("keydown", (e) => e.key === "Escape" && pick(null));

  let resizing;
  const sizes = new ResizeObserver(() => {
    if (!data || sizeKey() === box) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => data && render(), 100);
  });
  sizes.observe($("stage"));
  sizes.observe($("hub"));

  function live() {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => apply(JSON.parse(e.data));
    es.onerror = () => {
      es.close();
      setTimeout(live, 3000);
    };
  }
  const fonts = Promise.race([document.fonts?.load('800 38px "Archivo"'), new Promise((done) => setTimeout(done, 1500))]).catch(() => {});
  Promise.all([fetch("/api/map", { cache: "no-store" }).then((res) => res.json()), fonts])
    .then(([map]) => apply(map))
    .catch(() => {})
    .finally(live);

  let joinTimer;
  function closeJoin() {
    clearTimeout(joinTimer);
    $("join-done").hidden = true;
    $("core").classList.remove("joining");
  }
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
      $("phone").value = "";
      $("core").classList.add("joining");
      clearTimeout(joinTimer);
      joinTimer = setTimeout(closeJoin, 4 * 60_000);
      if (touch) location.href = out.link;
    } catch (err) {
      note.className = "join-note bad";
      note.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });
})();
