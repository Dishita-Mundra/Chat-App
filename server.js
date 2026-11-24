require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => res.json({
  ok: true, database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
}));

function createToken(user) {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing from .env");
  return jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1d" });
}
function publicUser(user) {
  return { id: user._id.toString(), username: user.username, email: user.email, bio: user.bio || "", avatarUrl: user.avatarUrl || "", location: user.location || "", createdAt: user.createdAt };
}
app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!username || !email || !password) return res.status(400).json({ message: "All fields are required." });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ message: "Display name must be 3–30 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
    const user = await User.create({ username, email, password: await bcrypt.hash(password, 12) });
    return res.status(201).json({ message: "Account created.", user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "This email is already registered. Please sign in." });
    console.error("Signup error:", error);
    return res.status(500).json({ message: "Signup failed. Check the server terminal." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }
    return res.json({ message: "Login successful.", token: createToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed. Check the server terminal." });
  }
});
app.get("/api/auth/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("_id username email bio avatarUrl location createdAt");
    if (!user) return res.status(401).json({ message: "Account not found." });
    res.json({ user: publicUser(user) });
  } catch { res.status(401).json({ message: "Session expired. Please sign in again." }); }
});

function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch { res.status(401).json({ message: "Session expired. Please sign in again." }); }
}
app.put("/api/profile", requireUser, async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
    const avatarUrl = typeof req.body.avatarUrl === "string" ? req.body.avatarUrl.trim() : "";
    const location = typeof req.body.location === "string" ? req.body.location.trim() : "";
    if (username.length < 3 || username.length > 30) return res.status(400).json({ message: "Display name must be 3–30 characters." });
    if (bio.length > 240) return res.status(400).json({ message: "Bio must be 240 characters or fewer." });
    if (location.length > 80) return res.status(400).json({ message: "Location must be 80 characters or fewer." });
    if (avatarUrl && (!/^https:\/\//i.test(avatarUrl) || avatarUrl.length > 500)) return res.status(400).json({ message: "Profile picture must be a valid HTTPS image URL." });
    const user = await User.findByIdAndUpdate(req.userId, { username, bio, avatarUrl, location }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: "Account not found." });
    res.json({ message: "Profile updated.", user: publicUser(user) });
  } catch (error) { console.error("Profile update error:", error); res.status(500).json({ message: "Could not update profile." }); }
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication required"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("_id username email bio avatarUrl location createdAt");
    if (!user) return next(new Error("User not found"));
    socket.user = { id: user._id.toString(), username: user.username, email: user.email, avatarUrl: user.avatarUrl || "" };
    next();
  } catch { next(new Error("Invalid or expired token")); }
});

const roomCounts = () => {
  const counts = {};
  for (const room of io.sockets.adapter.rooms.keys()) {
    const sockets = io.sockets.adapter.rooms.get(room);
    if (sockets && !io.sockets.sockets.has(room)) counts[room] = sockets.size;
  }
  return counts;
};
io.on("connection", socket => {
  io.emit("online-count", io.engine.clientsCount);
  socket.emit("active", io.engine.clientsCount);
  socket.on("join-room", async payload => {
    try {
      let room = payload && typeof payload.room === "string" ? payload.room.trim() : "";
      if (!room || room.length > 50) return socket.emit("chat-error", "Room name must be 1–50 characters.");
      if (socket.data.room) socket.leave(socket.data.room);
      await socket.join(room);
      socket.data.room = room;
      const docs = await Message.find({ room }).sort({ createdAt: -1 }).limit(100).populate("sender", "username").lean();
      const history = docs.reverse().map(doc => ({
        username: doc.sender?.username || "Unknown",
        message: doc.message, type: "message", createdAt: doc.createdAt
      }));
      socket.emit("room-joined", { room, username: socket.user.username, history });
      socket.to(room).emit("chat", { username: "System", message: `${socket.user.username} joined the room`, type: "system" });
    } catch (error) {
      console.error("Join room error:", error);
      socket.emit("chat-error", "Could not join room. Please try again.");
    }
  });
  socket.on("chat-message", async raw => {
    try {
      const room = socket.data.room;
      const message = typeof raw === "string" ? raw.trim() : "";
      if (!room) return socket.emit("chat-error", "Join a room before sending messages.");
      if (!message || message.length > 1000) return socket.emit("chat-error", "Message must be 1–1000 characters.");
      const saved = await Message.create({ room, sender: socket.user.id, message });
      io.to(room).emit("chat", {
        username: socket.user.username, message: saved.message, type: "message",
        createdAt: saved.createdAt, time: new Date(saved.createdAt).toLocaleTimeString()
      });
    } catch (error) {
      console.error("Save message error:", error);
      socket.emit("chat-error", "Message could not be saved. Check MongoDB connection.");
    }
  });
  socket.on("disconnecting", () => {
    const room = socket.data.room;
    if (room) socket.to(room).emit("chat", { username: "System", message: `${socket.user.username} left the room`, type: "system" });
  });
  socket.on("disconnect", () => io.emit("online-count", io.engine.clientsCount));
});

const PORT = Number(process.env.PORT) || 8080;
async function startServer() {
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing from .env");
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing from .env");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    httpServer.listen(PORT, () => console.log(`ChatApp running at http://localhost:${PORT}/client.html`));
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}
startServer();
