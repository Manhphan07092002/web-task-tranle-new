import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';

let io: SocketIOServer;

export const initSocket = (server: HttpServer, db: any) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGIN must be configured before Socket.IO starts in production');
  }
  io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : undefined,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || String(socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token || !process.env.JWT_SECRET) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (typeof payload.sub !== 'string' || !payload.sub || !Number.isSafeInteger(payload.tokenVersion) || Number(payload.tokenVersion) < 0) {
        return next(new Error('Unauthorized'));
      }
      const user = await db.get('SELECT id, isLocked, lockedUntil, tokenVersion FROM users WHERE id = ?', [payload.sub]);
      const temporarilyLocked = user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
      if (!user || user.isLocked || temporarilyLocked || Number(user.tokenVersion || 0) !== Number(payload.tokenVersion)) {
        return next(new Error('Unauthorized'));
      }
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.join(socket.data.userId);
    console.log(`[Socket.IO] Socket ${socket.id} joined room ${socket.data.userId}`);

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io is not initialized!');
  }
  return io;
};
