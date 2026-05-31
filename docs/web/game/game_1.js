/**
 * maze-game — drag-to-draw newspaper maze
 * for gretathorkels.net / Emporium
 *
 * Integration
 * ───────────
 *   Game key:   "maze-game"
 *   Trigger:    <a class="game-trigger" data-game="maze-game">solve the maze</a>
 *   Place file: /game/game.js
 */

const gameInstance = {

  // ─── Dimensions (required by spec) ────────────────────────────
  width:  500,
  height: 430,

  // ─── Canvas internals ──────────────────────────────────────────
  CANVAS_W: 500,
  CANVAS_H: 358,

  // Maze grid
  COLS:      15,
  ROWS:      11,
  CELL_SIZE: 28,    // px per cell
  WALL_W:    1.5,   // inner wall line width
  BORDER_W:  2,     // outer border width

  // ─── Colour palette ───────────────────────────────────────────
  // Matches gretathorkels.net: black ground, green walls, hot-pink path
  C: {
    bg:       '#000000',
    border:   '#ffffff',            // white outer frame
    wall:     '#1de870',            // bright green inner walls
    path:     '#ff2d78',            // hot-pink player path
    pathGlow: 'rgba(255,45,120,0.4)',
    pathDot:  '#ffffff',
    entryClr: '#1de870',            // green entry arrow
    exitClr:  '#ffdd00',            // yellow exit arrow
    textDim:  '#333333',
    winGold:  '#ffdd00',
  },

  // ─── Render HTML (required by spec) ──────────────────────────
  render: `
<div id="mz-wrap" style="
  width:100%; height:100%; background:#000;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  font-family:'HAL Timezone Mono','Courier New',monospace;
  user-select:none; -webkit-user-select:none; box-sizing:border-box;
">
  <div id="mz-hdr" style="
    color:#1de870; font-size:10px; letter-spacing:8px;
    text-transform:uppercase; margin-bottom:7px; opacity:.65;
  ">— M A Z E —</div>

  <canvas id="mz-canvas" width="500" height="358"
    style="display:block;"></canvas>

  <div id="mz-msg" style="
    color:#333; font-size:9px; letter-spacing:2.5px;
    text-transform:uppercase; margin-top:8px;
    text-align:center; min-height:14px; transition:color .4s;
  ">hold at entry &nbsp;·&nbsp; wall or release = restart</div>

  <button id="mz-again" style="
    display:none; background:transparent; color:#ff2d78;
    border:1px solid #ff2d78; padding:5px 20px; margin-top:8px;
    font-family:'HAL Timezone Mono','Courier New',monospace;
    font-size:9px; letter-spacing:4px; text-transform:uppercase;
    cursor:pointer;
  ">new maze</button>
</div>`,

  // ─── Runtime state ─────────────────────────────────────────────
  walls:     null,   // [row][col] = { top, right, bottom, left }
  startCell: null,   // { col, row }
  endCell:   null,   // { col, row }
  ox:        0,      // maze left edge in canvas coords
  oy:        0,      // maze top edge in canvas coords

  state: {
    path:         [],
    isDrawing:    false,
    won:          false,
    flashing:     false,
    flashTimeout: null,
    winFrame:     0,
  },

  el:   {},   // DOM element refs
  _h:   null, // bound handler refs (for removal)
  _raf: null, // animation-frame id

  // ═══════════════════════════════════════════════════════════════
  //   MAZE GENERATION — recursive backtracker (DFS)
  // ═══════════════════════════════════════════════════════════════

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = 0 | (Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },

  generateMaze() {
    const C = this.COLS, R = this.ROWS;

    // Start with all walls present
    this.walls = Array.from({ length: R }, () =>
      Array.from({ length: C }, () =>
        ({ top: true, right: true, bottom: true, left: true })
      )
    );

    const visited = Array.from({ length: R }, () => new Array(C).fill(false));
    const DIRS = [
      { dc:  0, dr: -1, w: 'top',    ow: 'bottom' },
      { dc:  1, dr:  0, w: 'right',  ow: 'left'   },
      { dc:  0, dr:  1, w: 'bottom', ow: 'top'    },
      { dc: -1, dr:  0, w: 'left',   ow: 'right'  },
    ];

    visited[0][0] = true;
    const stack = [{ col: 0, row: 0 }];

    while (stack.length) {
      const cur   = stack[stack.length - 1];
      const avail = this._shuffle(
        DIRS.filter(({ dc, dr }) => {
          const nc = cur.col + dc, nr = cur.row + dr;
          return nc >= 0 && nc < C && nr >= 0 && nr < R && !visited[nr][nc];
        })
      );

      if (avail.length) {
        const { dc, dr, w, ow } = avail[0];
        const nc = cur.col + dc, nr = cur.row + dr;
        this.walls[cur.row][cur.col][w] = false;
        this.walls[nr][nc][ow]          = false;
        visited[nr][nc] = true;
        stack.push({ col: nc, row: nr });
      } else {
        stack.pop();
      }
    }

    // Open entry (left wall of startCell) and exit (right wall of endCell)
    this.walls[this.startCell.row][this.startCell.col].left  = false;
    this.walls[this.endCell.row][this.endCell.col].right     = false;
  },

  // ═══════════════════════════════════════════════════════════════
  //   HELPERS
  // ═══════════════════════════════════════════════════════════════

  getCellAt(cx, cy) {
    const col = Math.floor((cx - this.ox) / this.CELL_SIZE);
    const row = Math.floor((cy - this.oy) / this.CELL_SIZE);
    if (col < 0 || col >= this.COLS || row < 0 || row >= this.ROWS) return null;
    return { col, row };
  },

  // Canvas coordinates of cell centre
  cc(col, row) {
    return {
      x: this.ox + col * this.CELL_SIZE + this.CELL_SIZE * 0.5,
      y: this.oy + row * this.CELL_SIZE + this.CELL_SIZE * 0.5,
    };
  },

  same(a, b) { return a && b && a.col === b.col && a.row === b.row; },

  // True iff a and b are orthogonally adjacent with no wall between them
  canMove(a, b) {
    if (!a || !b) return false;
    const dc = b.col - a.col, dr = b.row - a.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return false;
    const w = this.walls[a.row][a.col];
    if (dc ===  1) return !w.right;
    if (dc === -1) return !w.left;
    if (dr ===  1) return !w.bottom;
    return !w.top;
  },

  // Mouse/touch → canvas coords (handles CSS scaling)
  _coords(e) {
    const r = this.el.canvas.getBoundingClientRect();
    const s = this.CANVAS_W / r.width;
    return { cx: (e.clientX - r.left) * s, cy: (e.clientY - r.top) * s };
  },

  // ═══════════════════════════════════════════════════════════════
  //   DRAWING
  // ═══════════════════════════════════════════════════════════════

  draw() {
    const { el: { ctx }, COLS, ROWS, CELL_SIZE, CANVAS_W, CANVAS_H, C } = this;
    const { ox, oy } = this;
    const mW = COLS * CELL_SIZE;
    const mH = ROWS * CELL_SIZE;
    const sc = this.startCell;
    const ec = this.endCell;

    // ── Background ─────────────────────────────────────────────
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Outer border (white, gaps at entry/exit row) ────────────
    ctx.strokeStyle = C.border;
    ctx.lineWidth   = this.BORDER_W;
    ctx.lineCap     = 'square';
    ctx.beginPath();

    // Top (full)
    ctx.moveTo(ox,      oy);      ctx.lineTo(ox + mW, oy);
    // Bottom (full)
    ctx.moveTo(ox,      oy + mH); ctx.lineTo(ox + mW, oy + mH);

    // Left border — skip start row (entry gap)
    for (let r = 0; r < ROWS; r++) {
      if (r === sc.row) continue;
      ctx.moveTo(ox, oy + r       * CELL_SIZE);
      ctx.lineTo(ox, oy + (r + 1) * CELL_SIZE);
    }

    // Right border — skip end row (exit gap)
    for (let r = 0; r < ROWS; r++) {
      if (r === ec.row) continue;
      ctx.moveTo(ox + mW, oy + r       * CELL_SIZE);
      ctx.lineTo(ox + mW, oy + (r + 1) * CELL_SIZE);
    }

    ctx.stroke();

    // ── Inner walls (green) ─────────────────────────────────────
    // Draw only top + left wall per cell to avoid double-drawing.
    // Outer boundary is already handled above, so skip row 0 top
    // and col 0 left (those are the outer border).
    ctx.strokeStyle = C.wall;
    ctx.lineWidth   = this.WALL_W;
    ctx.lineCap     = 'square';
    ctx.beginPath();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const w = this.walls[row][col];
        const x = ox + col * CELL_SIZE;
        const y = oy + row * CELL_SIZE;

        if (row > 0 && w.top)  { ctx.moveTo(x, y); ctx.lineTo(x + CELL_SIZE, y); }
        if (col > 0 && w.left) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL_SIZE); }
      }
    }

    ctx.stroke();

    // ── Entry arrow (green, left side → pointing right) ─────────
    const entryY = oy + sc.row * CELL_SIZE + CELL_SIZE * 0.5;
    this._arrowR(ctx, ox, entryY, C.entryClr);

    // ── Exit arrow (yellow, right side → pointing right) ─────────
    const exitY = oy + ec.row * CELL_SIZE + CELL_SIZE * 0.5;
    this._arrowR(ctx, ox + mW + 14, exitY, C.exitClr);

    // ── Player path ─────────────────────────────────────────────
    const { path } = this.state;
    if (path.length > 0) {
      const pts = path.map(c => this.cc(c.col, c.row));

      ctx.save();
      ctx.shadowColor = C.pathGlow;
      ctx.shadowBlur  = 10;
      ctx.strokeStyle = C.path;
      ctx.lineWidth   = 3.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      ctx.beginPath();
      // Entry stub: from left maze edge to first cell centre
      ctx.moveTo(ox, entryY);
      ctx.lineTo(pts[0].x, pts[0].y);

      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);

      // Exit stub: extend to right maze edge when last cell is endCell
      if (this.same(path[path.length - 1], ec)) {
        ctx.lineTo(ox + mW, exitY);
      }

      ctx.stroke();

      // Dot at entry point
      ctx.shadowBlur = 0;
      ctx.fillStyle  = C.pathDot;
      ctx.beginPath();
      ctx.arc(ox, entryY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // ── Win overlay ──────────────────────────────────────────────
    if (this.state.won) this._drawWin();
  },

  // Right-pointing arrowhead; tipX is the pointed end
  _arrowR(ctx, tipX, midY, color) {
    const w = 9, h = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX,     midY);
    ctx.lineTo(tipX - w, midY - h);
    ctx.lineTo(tipX - w, midY + h);
    ctx.closePath();
    ctx.fill();
  },

  _drawWin() {
    const { el: { ctx }, CANVAS_W, CANVAS_H, C, state } = this;
    const p = 0.55 + 0.45 * Math.sin(state.winFrame * 0.07);

    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Pulsing gold title
    ctx.shadowColor = C.winGold;
    ctx.shadowBlur  = 12 + p * 28;
    ctx.fillStyle   = C.winGold;
    ctx.font        = `bold 36px 'HAL Timezone','HAL Timezone Mono','Courier New',monospace`;
    ctx.fillText('FOUND', CANVAS_W / 2, CANVAS_H / 2 - 16);

    // Subtitle
    ctx.shadowBlur = 0;
    ctx.fillStyle  = `rgba(255,255,255,${0.45 + p * 0.55})`;
    ctx.font       = `10px 'HAL Timezone Mono','Courier New',monospace`;
    ctx.letterSpacing = '3px'; // not widely supported but harmless
    ctx.fillText('you found the way out', CANVAS_W / 2, CANVAS_H / 2 + 20);

    ctx.restore();
  },

  // ═══════════════════════════════════════════════════════════════
  //   GAME LOGIC
  // ═══════════════════════════════════════════════════════════════

  _flashReset() {
    if (this.state.flashing) return;
    this.state.flashing = true;

    // Immediate red wash
    const { el: { ctx }, CANVAS_W, CANVAS_H } = this;
    ctx.fillStyle = 'rgba(255,28,28,0.28)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    this.state.flashTimeout = setTimeout(() => {
      if (!this.el.ctx) return; // guard: destroyed while pending
      this.state.path         = [];
      this.state.isDrawing    = false;
      this.state.flashing     = false;
      this.state.flashTimeout = null;
      this.draw();
    }, 200);
  },

  // ─── Mouse handlers ───────────────────────────────────────────

  _down(e) {
    if (this.state.won || this.state.flashing) return;
    e.preventDefault();
    const { cx, cy } = this._coords(e);
    const cell = this.getCellAt(cx, cy);
    if (!cell || !this.same(cell, this.startCell)) return;

    this.state.path      = [{ ...this.startCell }];
    this.state.isDrawing = true;
    this.draw();
  },

  _move(e) {
    if (!this.state.isDrawing || this.state.won || this.state.flashing) return;
    e.preventDefault();
    const { cx, cy } = this._coords(e);
    const cell = this.getCellAt(cx, cy);
    if (!cell) return;

    const path = this.state.path;
    const last  = path[path.length - 1];

    if (this.same(cell, last)) return; // still in same cell

    // Backtrack: move to the previous cell in path (retracts last step)
    if (path.length >= 2 && this.same(cell, path[path.length - 2])) {
      path.pop();
      this.draw();
      return;
    }

    // Wall collision or non-adjacent jump → erase and restart
    if (!this.canMove(last, cell)) { this._flashReset(); return; }

    // Loop detection → erase and restart
    if (path.some(c => this.same(c, cell))) { this._flashReset(); return; }

    // Valid move
    path.push({ col: cell.col, row: cell.row });

    if (this.same(cell, this.endCell)) {
      // ── WIN ──────────────────────────────────────────────────
      this.state.won       = true;
      this.state.isDrawing = false;
      this.draw();

      const msg   = document.getElementById('mz-msg');
      const again = document.getElementById('mz-again');
      if (msg)   { msg.textContent = '✦  you found the way out  ✦'; msg.style.color = '#ffdd00'; }
      if (again) { again.style.display = 'inline-block'; }

      this._raf = requestAnimationFrame(this._winLoop.bind(this));

      // ── WIN HOOK ─────────────────────────────────────────────
      // TODO: trigger whatever "something happens" effect you want here.
      // e.g. dispatch a custom event:
      //   document.dispatchEvent(new CustomEvent('maze-solved'));
    } else {
      this.draw();
    }
  },

  _up() {
    if (!this.state.isDrawing || this.state.won) return;
    this._flashReset();
  },

  _winLoop() {
    if (!this.state.won || !this.el.ctx) return;
    this.state.winFrame++;
    this.draw();
    this._raf = requestAnimationFrame(this._winLoop.bind(this));
  },

  // ─── Touch passthrough ────────────────────────────────────────
  _touch(type, e) {
    e.preventDefault();
    const t    = type === 'end' ? e.changedTouches[0] : e.touches[0];
    const fake = { clientX: t.clientX, clientY: t.clientY, preventDefault() {} };
    if      (type === 'start') this._down(fake);
    else if (type === 'move')  this._move(fake);
    else                       this._up(fake);
  },

  // ─── New game ─────────────────────────────────────────────────
  _newGame() {
    if (this._raf)              { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.state.flashTimeout){ clearTimeout(this.state.flashTimeout); }

    this.state = { path: [], isDrawing: false, won: false,
                   flashing: false, flashTimeout: null, winFrame: 0 };

    const msg   = document.getElementById('mz-msg');
    const again = document.getElementById('mz-again');
    if (msg)   { msg.textContent = 'hold at entry · wall or release = restart';
                 msg.style.color = '#333'; }
    if (again) { again.style.display = 'none'; }

    this.generateMaze();
    this.draw();
  },

  // ═══════════════════════════════════════════════════════════════
  //   LIFECYCLE  (required by spec)
  // ═══════════════════════════════════════════════════════════════

  init() {
    const canvas = document.getElementById('mz-canvas');
    const ctx    = canvas.getContext('2d');
    const wrap   = document.getElementById('mz-wrap');
    const msg    = document.getElementById('mz-msg');
    const again  = document.getElementById('mz-again');

    this.el = { canvas, ctx, wrap, msg, again };

    // Maze layout — centred in canvas
    const midRow   = Math.floor(this.ROWS / 2);
    this.startCell = { col: 0,             row: midRow };
    this.endCell   = { col: this.COLS - 1, row: midRow };
    this.ox        = Math.round((this.CANVAS_W - this.COLS * this.CELL_SIZE) / 2);
    this.oy        = Math.round((this.CANVAS_H - this.ROWS * this.CELL_SIZE) / 2);

    this.generateMaze();

    // Custom pencil cursor (hot-pink SVG, tip hotspot at ~3,21)
    const pencilSVG =
      `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>` +
      `<path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' fill='%23ff2d78'/>` +
      `<path d='M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23ffdd00'/>` +
      `</svg>`;
    const cur = `url("data:image/svg+xml,${pencilSVG}") 3 21, crosshair`;
    canvas.style.cursor = cur;
    wrap.style.cursor   = cur;

    this.draw();

    // Bind handlers (stored for removal in destroy)
    this._h = {
      down:   this._down.bind(this),
      move:   this._move.bind(this),
      up:     this._up.bind(this),
      tstart: (e) => this._touch('start', e),
      tmove:  (e) => this._touch('move',  e),
      tend:   (e) => this._touch('end',   e),
      replay: () => this._newGame(),
    };

    canvas.addEventListener('mousedown',   this._h.down);
    canvas.addEventListener('mousemove',   this._h.move);
    document.addEventListener('mouseup',   this._h.up);
    canvas.addEventListener('touchstart',  this._h.tstart, { passive: false });
    canvas.addEventListener('touchmove',   this._h.tmove,  { passive: false });
    canvas.addEventListener('touchend',    this._h.tend,   { passive: false });
    if (again) again.addEventListener('click', this._h.replay);
  },

  destroy() {
    const { canvas } = this.el;

    if (canvas && this._h) {
      canvas.removeEventListener('mousedown',  this._h.down);
      canvas.removeEventListener('mousemove',  this._h.move);
      canvas.removeEventListener('touchstart', this._h.tstart);
      canvas.removeEventListener('touchmove',  this._h.tmove);
      canvas.removeEventListener('touchend',   this._h.tend);
    }
    if (this._h)         document.removeEventListener('mouseup', this._h.up);
    if (this._raf)       cancelAnimationFrame(this._raf);
    if (this.state.flashTimeout) clearTimeout(this.state.flashTimeout);

    const again = document.getElementById('mz-again');
    if (again && this._h?.replay) again.removeEventListener('click', this._h.replay);

    // Reset everything
    this.walls = null;
    this.state = { path: [], isDrawing: false, won: false,
                   flashing: false, flashTimeout: null, winFrame: 0 };
    this.el    = {};
    this._h    = null;
    this._raf  = null;
  },
};
