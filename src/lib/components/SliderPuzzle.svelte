<script>
  let { puzzle, disabled = false, onrelease } = $props();
  let moveX = $state(0), dragging = $state(false), released = $state(false);
  let origin, path, scale, error = $state('');
  $effect(() => { if (!disabled) { released = false; moveX = 0; } });
  const percent = value => `${value / puzzle.width * 100}%`;
  const point = event => [Math.max(0, Math.min(puzzle.track, Math.round((event.clientX - origin.x) / scale))), Math.round((event.clientY - origin.y) / scale), Math.round(event.timeStamp - origin.at)];
  function down(event) {
    if (disabled || released || dragging || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scale = event.currentTarget.parentElement.getBoundingClientRect().width / puzzle.width;
    origin = { x: event.clientX, y: event.clientY, at: event.timeStamp, id: event.pointerId };
    error = '';
    path = [[0, 0, 0]];
    dragging = true;
  }
  function move(event) {
    if (!dragging || event.pointerId !== origin.id) return;
    const next = point(event);
    moveX = next[0];
    if (next[2] - path.at(-1)[2] >= 16) path.push(next);
  }
  function up(event) {
    if (!dragging || event.pointerId !== origin.id) return;
    dragging = false;
    const last = point(event);
    if (last[2] - path.at(-1)[2] < 16 && path.length > 1) path[path.length - 1] = last;
    else path.push(last);
    moveX = last[0];
    if (!moveX) return;
    if (last[2] > 8000) { error = 'Geser dan lepaskan dalam 8 detik. Coba lagi.'; moveX = 0; return; }
    released = true;
    onrelease(fit(path));
  }
  function fit(points) {
    return points.length > 400 ? points.filter((_, index) => index % Math.ceil(points.length / 399) === 0).concat([points.at(-1)]) : points;
  }
</script>

<div class="slider-puzzle" style:max-width="{puzzle.width}px" role="group" aria-label="Puzzle verifikasi MDAC. Geser tombol hingga potongan pas dengan lubang.">
  <div class="slider-puzzle-image" style:aspect-ratio="{puzzle.width} / {puzzle.height}">
    <img src={puzzle.background} alt="" draggable="false" style:width={percent(puzzle.width - 2)} />
    <img class="slider-puzzle-piece" src={puzzle.piece} alt="" draggable="false" style:width={percent(puzzle.pieceWidth)} style:left={percent(puzzle.ratio * moveX)} />
  </div>
  <div class="slider-puzzle-track" class:active={dragging}>
    <div class="slider-puzzle-fill" style:width={percent(moveX + 20)}></div>
    <button type="button" aria-label="Geser potongan puzzle" aria-disabled={disabled || released} class="slider-puzzle-knob" class:disabled={disabled || released} style:left={percent(moveX)} style:width={percent(40)} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { dragging = false; moveX = 0; }}>→</button>
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
</div>
