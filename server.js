const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- GAME SETTINGS (EDIT THESE!) ---
const BOARD_SIZE = 100;      // 100x100 grid (increase for more players)
const COOLDOWN_MS = 0;    // 0ms = 0 second move cooldown
// -----------------------------------

app.use(express.static(path.join(__dirname, 'public')));

// Board state: key = "x,y", value = { type, color, ownerId }
const board = new Map();
const players = new Map();

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 55%)`;
}

function spawnPlayer(id, color) {
  // Spawn a King and 8 surrounding Pawns in a random spot
  const cx = Math.floor(Math.random() * (BOARD_SIZE - 4)) + 2;
  const cy = Math.floor(Math.random() * (BOARD_SIZE - 4)) + 2;

  board.set(`${cx},${cy}`, { type: 'K', color, ownerId: id });

  const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  for (const [dx, dy] of offsets) {
    const key = `${cx + dx},${cy + dy}`;
    if (!board.has(key)) {
      board.set(key, { type: 'P', color, ownerId: id });
    }
  }
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substring(2, 10);
  const color = randomColor();
  players.set(id, { id, color, lastMove: 0 });

  spawnPlayer(id, color);

  // Send initial state to new player
  ws.send(JSON.stringify({
    type: 'init',
    id,
    color,
    boardSize: BOARD_SIZE,
    cooldown: COOLDOWN_MS,
    board: Array.from(board.entries())
  }));

  broadcast({ type: 'fullSync', board: Array.from(board.entries()) });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'move') {
      const player = players.get(id);
      const now = Date.now();

      // 1. Check Server Cooldown
      if (now - player.lastMove < COOLDOWN_MS) return;

      const { fx, fy, tx, ty } = data;
      if (tx < 0 || ty < 0 || tx >= BOARD_SIZE || ty >= BOARD_SIZE) return;

      const fromKey = `${fx},${fy}`;
      const toKey = `${tx},${ty}`;
      const piece = board.get(fromKey);

      // 2. Verify player owns the piece and isn't capturing their own piece
      if (!piece || piece.ownerId !== id) return;
      const target = board.get(toKey);
      if (target && target.ownerId === id) return;

      // 3. Basic 1-step movement check (expandable to full chess rules)
      const dx = Math.abs(tx - fx);
      const dy = Math.abs(ty - fy);
      if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) return;

      // Execute Move & Update Cooldown
      player.lastMove = now;
      board.delete(fromKey);
      board.set(toKey, piece);

      // Respawn player if their King was captured
      if (target && target.type === 'K') {
        spawnPlayer(target.ownerId, target.color);
      }

      broadcast({ type: 'fullSync', board: Array.from(board.entries()) });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    // Remove disconnected player's pieces
    for (const [key, piece] of board.entries()) {
      if (piece.ownerId === id) board.delete(key);
    }
    broadcast({ type: 'fullSync', board: Array.from(board.entries()) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`FFA Chess running on port ${PORT}`));
