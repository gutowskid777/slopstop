// The night sky, for pages other than the tree: three depths of stars that breathe, a few bright ones with a glow.
(() => {
  const c = document.getElementById("sky");
  if (!c) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stars = [];
  let W = 0, H = 0, D = 1, last = 0;
  function seed() {
    D = Math.min(2, devicePixelRatio || 1);
    W = c.width = innerWidth * D;
    H = c.height = innerHeight * D;
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    stars.length = 0;
    const n = Math.round(Math.min(1100, (innerWidth * innerHeight) / 1500));
    for (let i = 0; i < n; i++) {
      const depth = rnd();
      stars.push({ x: rnd() * W, y: rnd() * H, r: (depth > 0.985 ? 1.9 : depth > 0.9 ? 1.2 : 0.35 + depth * 0.6) * D, a: 0.18 + depth * 0.72, speed: 0.4 + rnd() * 1.6, phase: rnd() * 6.28, glow: depth > 0.985, tint: rnd() < 0.22 ? "#a9c4ff" : rnd() < 0.1 ? "#ffe2b0" : "#ffffff" });
    }
  }
  function draw(now) {
    const g = c.getContext("2d"), t = now / 1000;
    g.clearRect(0, 0, W, H);
    for (const st of stars) {
      g.globalAlpha = st.a * (still ? 1 : 0.62 + 0.38 * Math.sin(t * st.speed + st.phase));
      g.fillStyle = st.tint;
      if (st.glow) {
        const halo = g.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r * 7);
        halo.addColorStop(0, st.tint);
        halo.addColorStop(0.18, "rgba(170, 196, 255, 0.35)");
        halo.addColorStop(1, "rgba(170, 196, 255, 0)");
        g.fillStyle = halo;
        g.fillRect(st.x - st.r * 7, st.y - st.r * 7, st.r * 14, st.r * 14);
        g.fillStyle = "#ffffff";
        g.fillRect(st.x - st.r * 5, st.y - 0.35 * D, st.r * 10, 0.7 * D);
        g.fillRect(st.x - 0.35 * D, st.y - st.r * 5, 0.7 * D, st.r * 10);
      }
      g.beginPath();
      g.arc(st.x, st.y, st.r, 0, 6.3);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function tick(now) {
    if (now - last > 40) {
      last = now;
      draw(now);
    }
    requestAnimationFrame(tick);
  }
  seed();
  draw(0);
  if (!still) requestAnimationFrame(tick);
  addEventListener("resize", () => (seed(), draw(performance.now())));
})();
