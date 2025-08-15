// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;

// In-memory rooms store
const rooms = new Map();

function createRoom(roomId) {
  const chess = new Chess();
  rooms.set(roomId, {
    chess,
    players: { white: null, black: null },
    spectators: new Set(),
    history: [],
  });
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // Join a room
  socket.on('joinRoom', ({ roomId, preferColor }, cb) => {
    if (!roomId) return cb({ ok: false, error: 'roomId required' });
    if (!rooms.has(roomId)) createRoom(roomId);
    const room = rooms.get(roomId);

    // decide role
    let role = 'spectator';
    if (!room.players.white || !room.players.black) {
      if (preferColor === 'white' && !room.players.white) role = 'white';
      else if (preferColor === 'black' && !room.players.black) role = 'black';
      else if (!room.players.white) role = 'white';
      else if (!room.players.black) role = 'black';
    }

    if (role === 'white' || role === 'black') {
      room.players[role] = socket.id;
      socket.join(roomId);
      socket.data = { roomId, role };
      console.log(`socket ${socket.id} joined ${roomId} as ${role}`);
    } else {
      room.spectators.add(socket.id);
      socket.join(roomId);
      socket.data = { roomId, role };
      console.log(`socket ${socket.id} joined ${roomId} as spectator`);
    }

    cb({
      ok: true,
      role,
      fen: room.chess.fen(),
      history: room.history,
    });

    io.to(roomId).emit('playerUpdate', {
      players: room.players,
      spectatorCount: room.spectators.size,
    });
  });

  // Play a move
  socket.on('playMove', ({ roomId, from, to, promotion }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'room not found' });

    const role = socket.data?.role;
    if (role !== 'white' && role !== 'black') return cb && cb({ ok: false, error: 'not a player' });

    const color = room.chess.turn() === 'w' ? 'white' : 'black';
    if (role !== color) return cb && cb({ ok: false, error: 'not your turn' });

    const moveObj = { from, to };
    if (promotion) moveObj.promotion = promotion;

    const moveResult = room.chess.move(moveObj);
    if (moveResult === null) return cb && cb({ ok: false, error: 'illegal move' });

    room.history.push(moveResult.san);

    io.to(roomId).emit('movePlayed', {
      from,
      to,
      promotion: promotion || null,
      fen: room.chess.fen(),
      san: moveResult.san,
      turn: room.chess.turn(),
      in_check: room.chess.in_check(),
      game_over: room.chess.game_over(),
      result: getGameResult(room.chess),
    });

    cb && cb({ ok: true });
  });

  // Resign
  socket.on('resign', ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'room not found' });
    const role = socket.data?.role;
    if (role !== 'white' && role !== 'black') return cb && cb({ ok: false, error: 'not a player' });

    const winner = role === 'white' ? 'black' : 'white';
    io.to(roomId).emit('gameOver', { type: 'resign', winner });
    cb && cb({ ok: true });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { roomId, role } = socket.data || {};
    console.log('disconnect', socket.id, roomId, role);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'white' || role === 'black') {
      if (room.players[role] === socket.id) room.players[role] = null;
    } else {
      room.spectators.delete(socket.id);
    }

    io.to(roomId).emit('playerUpdate', {
      players: room.players,
      spectatorCount: room.spectators.size,
    });

    // garbage collect empty rooms
    const noPlayers = !room.players.white && !room.players.black && room.spectators.size === 0;
    if (noPlayers) rooms.delete(roomId);
  });
});

function getGameResult(chess) {
  if (!chess.game_over()) return null;
  if (chess.in_checkmate()) return { type: 'checkmate', winner: chess.turn() === 'w' ? 'black' : 'white' };
  if (chess.in_stalemate()) return { type: 'stalemate' };
  if (chess.in_threefold_repetition()) return { type: 'threefold' };
  if (chess.insufficient_material()) return { type: 'insufficient_material' };
  if (chess.in_draw()) return { type: 'draw' };
  return { type: 'unknown' };
}

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
