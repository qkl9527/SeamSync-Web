const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();
const localIPs = getLocalIPs();
const firstLocalIp = localIPs[0];
console.log("localIPs:", localIPs, firstLocalIp);
const CORS_ORIGIN =  `http://${firstLocalIp}:3000` || process.env.CORS_ORIGIN || "http://localhost:3000";
// console.log("CORS_ORIGIN:", CORS_ORIGIN);

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: CORS_ORIGIN,
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
    // Keep original filename for display, but sanitize it for filesystem
    const originalName = file.originalname;
    // Sanitize filename to handle Chinese characters and special chars
    // const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const ext = originalName.substring(originalName.lastIndexOf('.'));
    // const safeName = nameWithoutExt.substring(0,16);
    // Generate unique filename with sanitized name
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, callback) => {
  // 解决中文名乱码的问题 latin1 是一种编码格式
  file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8"
  );
  callback(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
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

    console.log(`completeData has ${fileId}:`, fileUploads.has(fileId));
    console.log("completeData fileUploads:", fileUploads);
    if (fileUploads.has(fileId)) {
      const upload = fileUploads.get(fileId);
      upload.fileEntry.status = 'completed';
      upload.fileEntry.url = fileUrl;
      upload.fileEntry.progress = 100;


      upload.fileEntry.fileName = completeData.fileName;
      upload.fileEntry.fileOriginName = completeData.fileOriginName;

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

  // Heartbeat ping from client
  socket.on('heartbeat-ping', (data) => {
    // Respond to heartbeat ping
    socket.emit('heartbeat-pong', {
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
      received: data.timestamp
    });
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

  // Store original filename for download
  const originalFilename = req.file.originalname;
  const actualFilename = req.file.filename;

  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${actualFilename}`;

  res.json({
    success: true,
    fileId: actualFilename,  // Use actual filename as fileId
    fileName: originalFilename,  // Return original filename for display
    fileUrl: fileUrl
  });
});

// Serve uploaded files
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// Video download endpoint
app.get('/api/download/:fileId', (req, res) => {
  const { fileId } = req.params;
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const filePath = path.join(uploadDir, fileId);

  console.log("fileId:", fileId)
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: 'File not found'
    });
  }

  // Get file stats
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;

  // Set headers for download
  res.setHeader('Content-Type', 'application/octet-stream');

  // Handle Chinese filenames in Content-Disposition
  // Since we saved the original filename in the upload response,
  // we need to extract it from the fileId (which contains the original name)
  // Format: timestamp-random-originalname.ext

  // Extract original filename from the saved filename
  const savedFilename = path.basename(filePath);
  const parts = savedFilename.split('-');
  const originalFilename = parts.slice(2).join('-'); // Skip timestamp and random number

  // Use original filename for display
  const displayFilename = decodeURIComponent(originalFilename);
  console.log(displayFilename, originalFilename)

  // Use RFC 6266 standard for filename encoding
  let contentDisposition = `attachment; filename="${displayFilename}"`;

  // Add RFC 6266 encoded filename for better browser compatibility
  const encodedFilename = encodeURIComponent(displayFilename);
  if (encodedFilename !== displayFilename) {
    contentDisposition += `; filename*=UTF-8''${encodedFilename}`;
  }

  res.setHeader('Content-Disposition', contentDisposition);
  res.setHeader('Content-Length', fileSize);

  // Create read stream and pipe to response
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  // Log download
  console.log(`📥 Video download started: ${displayFilename} (${formatBytes(fileSize)})`);

  // Handle download completion/error
  res.on('finish', () => {
    console.log(`✅ Video download completed: ${displayFilename}`);
  });

  res.on('error', (err) => {
    console.error(`❌ Video download error: ${err.message}`);
  });
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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