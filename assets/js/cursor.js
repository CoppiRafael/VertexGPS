(function () {
  if (matchMedia('(pointer: coarse)').matches) return;

  document.documentElement.classList.add('vx-cursor-active');

  const ring = document.createElement('div');
  ring.className = 'vx-cursor-ring';
  const dot = document.createElement('div');
  dot.className = 'vx-cursor-dot';
  document.body.append(ring, dot);

  let rx = 0, ry = 0, mx = 0, my = 0;

  function loop() {
    rx += (mx - rx) * 0.2;
    ry += (my - ry) * 0.2;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
  });

  document.addEventListener('mousedown', () => {
    ring.classList.add('is-active');
    dot.classList.add('is-active');
  });
  document.addEventListener('mouseup', () => {
    ring.classList.remove('is-active');
    dot.classList.remove('is-active');
  });

  document.addEventListener('mouseover', (e) => {
    const clickable = e.target.closest('a, button, [role="button"], input, select, textarea, .tab, label, summary, canvas');
    ring.classList.toggle('is-hover', !!clickable);
  });

  document.addEventListener('mouseleave', () => {
    ring.style.opacity = '0';
    dot.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    ring.style.opacity = '1';
    dot.style.opacity = '1';
  });
})();
