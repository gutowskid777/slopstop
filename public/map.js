// The branch map. The dark card in the middle is where the texts come in. Every idea is one line:
// it leaves the card bundled with its trunk, splits off with its branch and ends at the idea.
// A red line is an idea worth building, so the whole map reads as "follow the red".
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
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const r = (n) => Math.round(n * 10) / 10;
  const tall = () => matchMedia("(max-width: 1020px)").matches;
  // ?static draws the finished map with no motion (screenshots, slow machines).
  const still = new URLSearchParams(location.search).has("static") || matchMedia("(prefers-reduced-motion: reduce)").matches;

  let data = null;
  let known = null; // ids already drawn, so only a real arrival animates
  let picked = null; // the idea someone tapped
  let held = null; // a trunk or branch someone tapped, kept lit
  let landing = null;
  let box = ""; // the sizes at the last draw, so only a real size change redraws
  let seenRaw = "";
  let opening = !still; // the first paint grows the lines out of the card, once
  let spots = new Map(); // id -> { idea, t, b }
  let partners = new Map(); // id -> ids of ideas whose builders said yes to each other
  let layers = {};

  // Where each trunk and branch was first drawn. A new idea should add a line, not shuffle the map.
  const seat = new Map(); // trunk name -> which side of the card
  const rank = new Map(); // trunk or branch -> its place in line
  const place = (key) => rank.get(key) ?? rank.set(key, rank.size).get(key);

  // On first sight: biggest trunk first, biggest branch first. After that everything keeps its place.
  // Inside a branch the best idea is always on top.
  function tree() {
    const trunks = data.trunks.map((t, ti) => {
      const branches = t.branches
        .map((b, bi) => ({ name: b.name, key: `${ti}/${bi}`, ideas: [...b.ideas].sort((a, c) => c.score - a.score || a.at.localeCompare(c.at)) }))
        .sort((a, c) => c.ideas.length - a.ideas.length || c.ideas[0].score - a.ideas[0].score);
      return { name: t.name, ti: String(ti), branches, n: branches.reduce((s, b) => s + b.ideas.length, 0) };
    });
    trunks.sort((a, c) => c.n - a.n);
    for (const t of trunks) {
      place(`t:${t.name}`);
      for (const b of t.branches) place(`b:${t.name}/${b.name}`);
      t.branches.sort((a, c) => place(`b:${t.name}/${a.name}`) - place(`b:${t.name}/${c.name}`));
    }
    return trunks.sort((a, c) => place(`t:${a.name}`) - place(`t:${c.name}`));
  }

  // ---- the pieces both layouts draw with
  function wire(d, idea, t, b, order) {
    const moving = !still && (opening || idea.id === landing);
    const p = svg("path", { class: `w ${call(idea.score)[2]}${moving ? " grow" : ""}`, d, "data-i": idea.id, "data-b": b.key, "data-t": t.ti });
    if (moving) {
      p.setAttribute("pathLength", 1);
      if (opening) p.style.animationDelay = `${order * 12}ms`;
    }
    layers[call(idea.score)[2]].append(p);
  }
  function leaf(idea, t, b, side, order) {
    const e = node("button", `leaf ${side} ${call(idea.score)[2]} ${idea.sample ? "sample" : "real"}`);
    e.type = "button";
    if (idea.id === picked) e.classList.add("on");
    if (idea.id === data.latest) e.classList.add("here");
    if (idea.id === landing) e.classList.add("landing");
    if (opening) {
      e.classList.add("rise");
      e.style.animationDelay = `${700 + order * 12}ms`;
    }
    e.dataset.i = idea.id;
    e.dataset.b = b.key;
    e.dataset.t = t.ti;
    e.setAttribute("aria-label", `${idea.title}, ${idea.score} out of 100, ${call(idea.score)[1]}`);
    e.append(node("span", "dot"), node("span", "num", idea.score), node("span", "ttl", idea.title));
    spots.set(idea.id, { idea, t, b });
    $("nodes").append(e);
    return e;
  }
  function chip(kind, text, t, b, delay) {
    const e = node("div", `chip ${kind}${opening ? " rise" : ""}`, text);
    if (opening) e.style.animationDelay = `${delay}ms`;
    e.dataset.chip = kind;
    e.dataset.t = t.ti;
    if (b) e.dataset.b = b.key;
    $("nodes").append(e);
    return e;
  }

  // ---- wide: the card in the middle, trunks leaving to both sides
  const BG = 0.45, TG = 1; // the room between branches and between trunks, in rows
  const span = (t) => t.n + (t.branches.length - 1) * BG;
  const height = (side) => side.reduce((s, t) => s + span(t), 0) + Math.max(0, side.length - 1) * TG;
  const bend = (x1, y1, x2, y2) => `C${r((x1 + x2) / 2)},${r(y1)} ${r((x1 + x2) / 2)},${r(y2)} ${r(x2)},${r(y2)}`;

  function drawWide(trunks, canvas, stage) {
    const W = stage.clientWidth, view = stage.clientHeight;
    // Two sides, as even as they come. A trunk stays on the side it started on.
    const sides = [[], []];
    for (const t of trunks) {
      if (!seat.has(t.name)) seat.set(t.name, height(sides[1]) < height(sides[0]) ? 1 : 0);
      sides[seat.get(t.name)].push(t);
    }
    const rows = Math.max(height(sides[0]), height(sides[1]), 1);
    const pad = 24;
    const row = Math.max(19, Math.min(31, (view - pad * 2) / rows));
    const H = Math.max(view, Math.ceil(rows * row + pad * 2));
    canvas.style.height = `${H}px`;
    canvas.style.setProperty("--row", `${r(row)}px`);
    canvas.style.setProperty("--fs", `${r(Math.max(12.5, Math.min(17, row * 0.66)))}px`);
    $("wires").setAttribute("width", W);
    $("wires").setAttribute("height", H);

    // Where the card sits on the canvas. The lines leave from its two sides.
    const c = canvas.getBoundingClientRect(), h = $("hub").getBoundingClientRect();
    const hub = { l: h.left - c.left, r: h.right - c.left, y: h.top - c.top + h.height / 2, h: h.height };
    const most = Math.max(...sides.map((side) => side.reduce((s, t) => s + t.n, 0)), 1);
    const gap = Math.max(1.4, Math.min(4, (hub.h - 48) / most)); // how far apart two lines run in a bundle
    canvas.style.setProperty("--sw", `${r(Math.max(1.1, gap - 1))}px`);

    sides.forEach((side, s) => {
      const dir = s ? 1 : -1;
      const edge = s ? hub.r : hub.l;
      const room = (s ? W - hub.r : hub.l) - 18;
      const leafW = Math.max(132, Math.min(236, room * 0.4));
      const run = room - leafW - 12;
      // Names shrink with the room they have, so a smaller laptop never cuts one short.
      canvas.style.setProperty("--tf", `${r(Math.max(15, Math.min(21, run * 0.057)))}px`);
      canvas.style.setProperty("--bf", `${r(Math.max(12, Math.min(15, run * 0.041)))}px`);
      // Leaving the card: a fan, the trunk's name, a fan, the branch's name, a fan, the idea.
      const x = [-10 / run, 0.26, 0.5, 0.65, 0.88, 1].map((f) => edge + dir * f * run);

      let y = (H - height(side) * row) / 2;
      side.forEach((t, i) => {
        if (i) y += TG * row;
        const first = y;
        t.branches.forEach((b, j) => {
          if (j) y += BG * row;
          b.top = y;
          y += b.ideas.length * row;
          b.y = (b.top + y) / 2;
        });
        t.y = (first + y) / 2;
      });

      const n = side.reduce((sum, t) => sum + t.n, 0);
      let i = 0;
      for (const t of side) {
        let j = 0;
        for (const b of t.branches) {
          b.ideas.forEach((idea, k) => {
            const ya = hub.y + (i - (n - 1) / 2) * gap;
            const yb = t.y + (j - (t.n - 1) / 2) * gap;
            const yc = b.y + (k - (b.ideas.length - 1) / 2) * gap;
            const yd = b.top + (k + 0.5) * row;
            wire(`M${r(x[0])},${r(ya)} ${bend(x[0], ya, x[1], yb)} H${r(x[2])} ${bend(x[2], yb, x[3], yc)} H${r(x[4])} ${bend(x[4], yc, x[5], yd)}`, idea, t, b, i);
            const e = leaf(idea, t, b, s ? "r" : "l", i);
            e.style.top = `${r(yd)}px`;
            e.style.maxWidth = `${r(leafW + 10)}px`;
            if (s) e.style.left = `${r(x[5] - 5)}px`;
            else e.style.right = `${r(W - x[5] - 5)}px`;
            i++;
            j++;
          });
          const e = chip("b", b.name, t, b, 520);
          e.style.left = `${r((x[3] + x[4]) / 2)}px`;
          e.style.top = `${r(b.y)}px`;
          e.style.maxWidth = `${r(Math.abs(x[4] - x[3]) + 40)}px`;
        }
        const e = chip("t", t.name, t, null, 260);
        e.style.left = `${r((x[1] + x[2]) / 2)}px`;
        e.style.top = `${r(t.y)}px`;
        e.style.maxWidth = `${r(Math.abs(x[2] - x[1]) + 56)}px`;
      }
    });
  }

  // ---- tall: one trunk after another. Its lines hang down from the name and turn off to each idea.
  function drawTall(trunks, canvas, stage) {
    const W = stage.clientWidth;
    const row = 38, left = 18, gap = 3;
    const widest = Math.min(16, Math.max(...trunks.map((t) => t.n), 1));
    const dotX = left + widest * gap + 19;
    canvas.style.setProperty("--row", `${row}px`);
    canvas.style.setProperty("--fs", "16.5px");
    canvas.style.setProperty("--sw", "2px");
    let y = 6, order = 0;
    for (const t of trunks) {
      const name = chip("t", t.name, t, null, 200);
      name.style.left = `${left - 1}px`;
      name.style.top = `${y + 15}px`;
      y += 36;
      const top = y - 2;
      const step = Math.min(gap, (dotX - 19 - left) / t.n);
      let j = 0;
      for (const b of t.branches) {
        const tag = chip("b", b.name, t, b, 420);
        tag.style.left = `${dotX - 5}px`;
        tag.style.top = `${y + 13}px`;
        y += 25;
        for (const idea of b.ideas) {
          const ly = y + row / 2;
          // The first idea takes the line nearest the names, so no line ever crosses another.
          const lx = left + (t.n - 1 - j) * step + step / 2;
          const turn = Math.min(12, dotX - lx - 5);
          wire(`M${r(lx)},${top} V${r(ly - turn)} Q${r(lx)},${ly} ${r(lx + turn)},${ly} H${dotX}`, idea, t, b, order);
          const e = leaf(idea, t, b, "r", order);
          e.style.top = `${ly}px`;
          e.style.left = `${dotX - 5}px`;
          e.style.maxWidth = `${W - dotX - 9}px`;
          y += row;
          j++;
          order++;
        }
        y += 5;
      }
      y += 20;
    }
    canvas.style.height = `${y}px`;
    $("wires").setAttribute("width", W);
    $("wires").setAttribute("height", y);
  }

  const sizeKey = () => (tall() ? `tall/${$("stage").clientWidth}` : `${$("stage").clientWidth}x${$("stage").clientHeight}/${$("hub").offsetHeight}`);

  function render() {
    const stage = $("stage"), canvas = $("canvas");
    const trunks = tree();
    $("empty").hidden = trunks.length > 0;
    $("nodes").replaceChildren();
    layers = { drop: svg("g"), sharp: svg("g"), build: svg("g") };
    $("wires").replaceChildren(layers.drop, layers.sharp, layers.build);
    spots = new Map();
    partners = new Map();
    for (const [a, b] of data.links) {
      partners.set(a, [...(partners.get(a) ?? []), b]);
      partners.set(b, [...(partners.get(b) ?? []), a]);
    }
    box = sizeKey();
    canvas.classList.toggle("tall", tall());
    (tall() ? drawTall : drawWide)(trunks, canvas, stage);
    sign();
    rest();
    landing = null;
    opening = false;
  }

  // ---- lighting: one idea, one branch or one trunk stands out and the rest of the map steps back
  function light(key) {
    const stage = $("stage");
    stage.classList.toggle("focus", Boolean(key));
    if (!key) return void stage.querySelectorAll(".lit").forEach((e) => e.classList.remove("lit"));
    const kind = key[0], val = key.slice(2);
    // An idea lights its own line and the names it passes through. If its builder met another, theirs too.
    const mine = kind === "i" ? [val, ...(partners.get(val) ?? [])].map((id) => spots.get(id)).filter(Boolean) : [];
    for (const e of stage.querySelectorAll("[data-t]")) {
      const d = e.dataset;
      const on =
        kind === "t" ? d.t === val
        : kind === "b" ? d.b === val || (d.chip === "t" && d.t === val.split("/")[0])
        : mine.some((s) => (d.chip === "t" ? d.t === s.t.ti : d.chip === "b" ? d.b === s.b.key : d.i === s.idea.id));
      e.classList.toggle("lit", on);
    }
  }
  const rest = () => light(picked && spots.has(picked) ? `i:${picked}` : held);
  const keyOf = (target) => {
    const n = target.closest?.("[data-t]");
    if (!n) return null;
    return n.dataset.i ? `i:${n.dataset.i}` : n.dataset.chip === "b" ? `b:${n.dataset.b}` : `t:${n.dataset.t}`;
  };

  const ago = (iso) => {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return "Texted in just now";
    if (min < 60) return `Texted in ${min} min ago`;
    const h = Math.round(min / 60);
    return h < 24 ? `Texted in ${h} hr ago` : "Texted in earlier";
  };

  // One idea up close: the number, then the two ratings it came from.
  function sign() {
    const s = spots.get(picked);
    $("thread").hidden = Boolean(s);
    $("sign").hidden = !s;
    if (!s) return;
    const { idea } = s;
    const [, name, band] = call(idea.score);
    $("sign").dataset.band = band;
    const fresh = idea.id === data.latest && Date.now() - Date.parse(idea.at) < 5 * 60_000;
    $("sign-when").textContent = idea.sample ? "Sample idea" : fresh ? "Just landed" : ago(idea.at);
    $("sign-score").textContent = idea.score;
    $("sign-title").textContent = idea.title;
    $("sign-problem").textContent = idea.problem;
    $("sign-fix").textContent = idea.fix;
    $("sign-call").textContent = name;
    $("sign-where").textContent = `${s.t.name} / ${s.b.name}`;
    const met = (partners.get(idea.id) ?? []).map((id) => spots.get(id)).find(Boolean);
    $("sign-near").textContent = met
      ? `Connected with the builder on "${met.idea.title}"`
      : idea.near
        ? `${idea.near} ${idea.near === 1 ? "builder is" : "builders are"} close to it`
        : "";
  }

  function pick(id) {
    picked = id;
    for (const e of $("nodes").querySelectorAll(".leaf")) e.classList.toggle("on", e.dataset.i === id);
    sign();
    rest();
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
    if (picked && !ids.has(picked)) picked = null;
    if (fresh) {
      // The idea that just landed takes the map: its line draws in and the rest steps back.
      picked = fresh;
      held = null;
      landing = fresh;
      closeJoin(); // whoever scanned the code has texted: give the card back
    }
    render();
    if (fresh && tall()) $("nodes").querySelector(`.leaf[data-i="${fresh}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---- pointing and tapping
  $("nodes").addEventListener("pointerover", (e) => {
    const key = e.pointerType === "touch" ? null : keyOf(e.target);
    if (key) light(key);
  });
  $("nodes").addEventListener("pointerout", (e) => {
    if (e.pointerType !== "touch") rest();
  });
  $("stage").addEventListener("click", (e) => {
    const n = e.target.closest("[data-t]");
    if (n?.dataset.i) {
      held = null;
      return pick(n.dataset.i === picked ? null : n.dataset.i);
    }
    // A trunk or branch name holds its lines lit. A tap on open paper lets everything go.
    const key = n ? keyOf(n) : null;
    held = key && key !== held ? key : null;
    pick(null);
  });
  $("sign-close").addEventListener("click", () => pick(null));

  // Redraw when the map's box or the card changes size (window resize, the scan code opening, a phone rotating).
  let resizing;
  const sizes = new ResizeObserver(() => {
    if (!data || sizeKey() === box) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => data && render(), 100);
  });
  sizes.observe($("stage"));
  sizes.observe($("hub"));
  // If the map is taller than the window it scrolls under the card, and the lines stay attached to it.
  let frame;
  $("stage").addEventListener("scroll", () => {
    if (tall() || !data) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }, { passive: true });

  // ---- live: the server pushes the map the moment a text is scored
  function live() {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => apply(JSON.parse(e.data));
    es.onerror = () => {
      es.close();
      setTimeout(live, 3000);
    };
  }
  // The card's height depends on the typeface, so wait for it (briefly) before the first draw.
  const fonts = Promise.race([document.fonts?.load('800 40px "Archivo"'), new Promise((done) => setTimeout(done, 1500))]).catch(() => {});
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
