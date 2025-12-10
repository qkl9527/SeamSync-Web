const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024 // 50MB default
  }
});

// Data structures
const rooms = new Map(); // roomId -> room data
const fileUploads = new Map(); // fileId -> upload progress

// Room data structure
function createRoom() {
  return {
    id: uuidv4(),
    files: new Map(), // fileId -> file data
    users: new Set(), // connected user IDs
    createdAt: new Date()
  };
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom());
    }

    const room = rooms.get(roomId);
    room.users.add(socket.id);

    // Send current room state to the joining user
    socket.emit('room-joined', {
      roomId: roomId,
      files: Array.from(room.files.values()),
      userCount: room.users.size
    });

    // Notify other users in the room
    socket.to(roomId).emit('user-joined', {
      userCount: room.users.size
    });

    console.log(`User ${socket.id} joined room ${roomId}, total users: ${room.users.size}`);
  });

  // Leave a room
  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.users.delete(socket.id);

      socket.to(roomId).emit('user-left', {
        userCount: room.users.size
      });

      console.log(`User ${socket.id} left room ${roomId}, remaining users: ${room.users.size}`);
    }
  });

  // Handle file upload start
  socket.on('file-upload-start', (fileData) => {
    const { roomId, fileId, file } = fileData;

    // Create file entry
    // const fileId = uuidv4();
    const fileEntry = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedBy: socket.id,
      uploadedAt: new Date(),
      status: 'uploading',
      progress: 0
    };

    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom());
    }

    const room = rooms.get(roomId);
    room.files.set(fileId, fileEntry);

    // Store upload progress
    fileUploads.set(fileId, {
      roomId: roomId,
      fileEntry: fileEntry,
      progress: 0
    });

    console.log(`File upload started: ${file.name} in room ${roomId}`);
  });

  // Handle file upload complete
  socket.on('file-upload-complete', (completeData) => {
    console.log("completeData:", completeData);

    const { fileId, fileUrl } = completeData;

    console.log("completeData:", fileUploads.has(fileId));
    console.log("completeData:", fileUploads);
    if (fileUploads.has(fileId)) {
      const upload = fileUploads.get(fileId);
      upload.fileEntry.status = 'completed';
      upload.fileEntry.url = fileUrl;
      upload.fileEntry.progress = 100;

      // Notify all users in the room about file completion
      console.log(`📤 Broadcasting file-completed event for: ${upload.fileEntry.name}`);
      console.log(`📤 File ID: ${upload.fileEntry.id}`);
      console.log(`📤 Room: ${upload.roomId}`);
      console.log(`📤 URL: ${fileUrl}`);

      io.to(upload.roomId).emit('file-completed', upload.fileEntry);

      // Clean up
      fileUploads.delete(fileId);

      console.log(`File upload completed: ${upload.fileEntry.name}`);
      console.log(`  File ID: ${upload.fileEntry.id}`);
      console.log(`  URL: ${fileUrl}`);
      console.log(`  Room: ${upload.roomId}`);
    }
  });

  // Handle file upload error
  socket.on('file-upload-error', (errorData) => {
    const { fileId, error } = errorData;

    if (fileUploads.has(fileId)) {
      const upload = fileUploads.get(fileId);
      if (upload.fileEntry) {
        upload.fileEntry.status = 'error';
        upload.fileEntry.error = error;
      }

      // Notify room about error
      io.to(upload.roomId).emit('file-error', {
        fileId: fileId,
        error: error
      });

      // Clean up
      fileUploads.delete(fileId);

      console.log(`File upload error: ${error}`);
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Clean up user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        socket.to(roomId).emit('user-left', {
          userCount: room.users.size
        });
      }
    });

    // Clean up any uploads by this user
    fileUploads.forEach((upload, fileId) => {
      if (upload.fileEntry && upload.fileEntry.uploadedBy === socket.id) {
        fileUploads.delete(fileId);
      }
    });
  });
});

// API Routes

// Create new room
app.post('/api/rooms', (req, res) => {
  const roomId = uuidv4();
  const room = createRoom();
  room.id = roomId;
  rooms.set(roomId, room);

  res.json({
    success: true,
    roomId: roomId,
    url: `${req.protocol}://${req.get('host')}/room/${roomId}`
  });
});

// Get room info
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;

  if (!rooms.has(roomId)) {
    return res.status(404).json({
      success: false,
      message: 'Room not found'
    });
  }

  const room = rooms.get(roomId);
  res.json({
    success: true,
    roomId: roomId,
    fileCount: room.files.size,
    userCount: room.users.size,
    createdAt: room.createdAt
  });
});

// Upload file
app.post('/api/upload/:roomId', upload.single('file'), (req, res) => {
  const { roomId } = req.params;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

  res.json({
    success: true,
    fileId: req.file.filename,
    fileName: req.file.originalname,
    fileUrl: fileUrl
  });
});

// Serve uploaded files
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve room page
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Get local IP addresses
function getLocalIPs() {
  const interfaces = require('os').networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Skip internal and IPv6 addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        ips.push(interface.address);
      }
    }
  }

  return ips;
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIPs = getLocalIPs();

  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`\n🌐 Access URLs:`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://127.0.0.1:${PORT}`);

  if (localIPs.length > 0) {
    console.log(`\n🏠 Local Network IPs:`);
    localIPs.forEach((ip, index) => {
      console.log(`   ${index + 1}. http://${ip}:${PORT}`);
    });
  }

  if (localIPs.length === 0) {
    console.log(`\n⚠️  No local network IPs found. You can still use localhost.`);
  }
});