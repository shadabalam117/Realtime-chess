import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState('start');
  const [roomId, setRoomId] = useState('room1');
  const [role, setRole] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const s = io(SERVER, { transports: ['websocket'] });
    setSocket(s);

    s.on('connect', () => setStatus('connected'));
    s.on('disconnect', () => setStatus('disconnected'));

    s.on('movePlayed', (payload) => {
      chessRef.current.load(payload.fen);
      setFen(payload.fen);
      setHistory((h) => [...h, payload.san]);
    });

    s.on('playerUpdate', (p) => console.log('playerUpdate', p));
    s.on('gameOver', (g) => alert('Game over: ' + JSON.stringify(g)));

    return () => s.disconnect();
  }, []);

  const joinRoom = (prefer) => {
    if (!socket) return alert('socket not ready');
    socket.emit('joinRoom', { roomId, preferColor: prefer }, (res) => {
      if (!res.ok) return alert(res.error);
      setRole(res.role);
      chessRef.current = new Chess(res.fen);
      setFen(res.fen);
      setHistory(res.history || []);
    });
  };

  const onDrop = (from, to) => {
    const turn = chessRef.current.turn() === 'w' ? 'white' : 'black';
    if (role !== turn) return false;

    const moveResult = chessRef.current.move({ from, to, promotion: 'q' });
    if (!moveResult) return false;
    chessRef.current.undo();

    socket.emit('playMove', { roomId, from, to, promotion: 'q' }, (res) => {
      if (!res.ok) alert('Move rejected: ' + res.error);
    });
    return true;
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Realtime Chess</h2>
      <div style={{ marginBottom: 8 }}>
        Room:
        <input value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ marginLeft: 8 }} />
        <button onClick={() => joinRoom('white')} style={{ marginLeft: 8 }}>Join as White</button>
        <button onClick={() => joinRoom('black')} style={{ marginLeft: 8 }}>Join as Black</button>
        <button onClick={() => joinRoom()} style={{ marginLeft: 8 }}>Auto Join</button>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div>
          <Chessboard position={fen} onPieceDrop={(from, to) => onDrop(from, to)} />
        </div>
        <div>
          <div><strong>Role:</strong> {role || 'none'}</div>
          <div><strong>Status:</strong> {status}</div>
          <div style={{ marginTop: 16 }}>
            <strong>Move history</strong>
            <ol>
              {history.map((m, i) => <li key={i}>{m}</li>)}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
