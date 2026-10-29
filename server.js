const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose'); // Thư viện kết nối MongoDB

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// KẾT NỐI MONGODB (Thay chuỗi này bằng chuỗi của bạn)
// ==========================================
const MONGODB_URI = 'mongodb+srv://duongdzso123_db_user:123456789thy@cluster0.fqjnuxf.mongodb.net/game_db?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB thành công!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ĐỊNH NGHĨA CẤU TRÚC DỮ LIỆU (SCHEMA)
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: String,
    gold: { type: Number, default: 1000 },
    diamonds: { type: Number, default: 500 },
    kills: { type: Number, default: 0 },
    headshots: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    banned: { type: Boolean, default: false },
    ownedWeapons: { type: [String], default: ['pistol'] },
    currentWeapon: { type: String, default: 'pistol' },
    weaponLevels: { type: Object, default: { pistol: 1, rifle: 1, sniper: 1, bazooka: 1 } },
    mailbox: { type: Array, default: [] }
});

const leaderboardSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    kills: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Leaderboard = mongoose.model('Leaderboard', leaderboardSchema);

// HÀM TÍNH LEVEL VÀ RANK
function calculateStats(user) {
    let kills = user.kills || 0;
    let headshots = user.headshots || 0;
    let level = 1;
    let killsNeeded = 110;
    let tempKills = kills;
    while (tempKills >= killsNeeded) {
        tempKills -= killsNeeded;
        level++;
        killsNeeded += 50; 
    }
    let rank = Math.floor(kills / 100) * Math.floor(headshots / 50);
    if (rank === 0 && kills > 0) rank = 1;
    return { level, rank };
}

// API ĐĂNG KÝ
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Kiểm tra trùng tên (không phân biệt hoa thường)
        const existingUser = await User.findOne({ username: { $regex: new RegExp('^' + username + '$', 'i') } });
        if (existingUser) return res.json({ success: false, message: "Tên đăng nhập đã tồn tại!" });

        const newUser = new User({ username, password });
        await newUser.save();
        res.json({ success: true, message: "Đăng ký thành công!" });
    } catch (err) {
        res.json({ success: false, message: "Lỗi server khi đăng ký!" });
    }
});

// API ĐĂNG NHẬP
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const realUsername = await User.findOne({ username: { $regex: new RegExp('^' + username + '$', 'i') } });
        
        if (!realUsername || realUsername.password !== password) {
            return res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu!" });
        }
        if (realUsername.banned) {
            return res.json({ success: false, message: "Tài khoản của bạn đã bị khóa bởi Admin!" });
        }
        
        const stats = calculateStats(realUsername);
        res.json({ success: true, message: "Đăng nhập thành công!", userData: { 
            username: realUsername.username, 
            gold: realUsername.gold, 
            diamonds: realUsername.diamonds, 
            mailbox: realUsername.mailbox || [],
            kills: realUsername.kills, 
            headshots: realUsername.headshots, 
            isAdmin: realUsername.isAdmin,
            level: stats.level, 
            rank: stats.rank,
            ownedWeapons: realUsername.ownedWeapons, 
            currentWeapon: realUsername.currentWeapon,
            weaponLevels: realUsername.weaponLevels
        }});
    } catch (err) {
        res.json({ success: false, message: "Lỗi server khi đăng nhập!" });
    }
});

// API CẬP NHẬT KHO ĐỒ
app.post('/api/update-inventory', async (req, res) => {
    const { username, gold, diamonds, ownedWeapons, currentWeapon, weaponLevels } = req.body;
    try {
        await User.updateOne({ username: username }, { 
            gold, diamonds, ownedWeapons, currentWeapon, weaponLevels 
        });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

// API LẤY HỒ SƠ
app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: { $regex: new RegExp('^' + req.params.username + '$', 'i') } });
        if (!user) return res.json({ success: false });
        
        const stats = calculateStats(user);
        res.json({ success: true, profile: {
            username: user.username, kills: user.kills, headshots: user.headshots,
            isAdmin: user.isAdmin, level: stats.level, rank: stats.rank
        }});
    } catch (err) {
        res.json({ success: false });
    }
});

// API BAN / CẤP ADMIN
app.post('/api/admin-action', async (req, res) => {
    const { adminUser, targetUser, action } = req.body;
    if (!adminUser || adminUser.toLowerCase() !== 'admin') {
        return res.json({ success: false, message: "Bạn không có quyền!" });
    }
    
    try {
        const user = await User.findOne({ username: { $regex: new RegExp('^' + targetUser + '$', 'i') } });
        if (!user) return res.json({ success: false, message: "Không tìm thấy người chơi!" });

        if (action === 'setAdmin') user.isAdmin = true;
        if (action === 'ban') user.banned = true;
        await user.save();

        if (action === 'ban') io.emit('forceLogout', { username: user.username, reason: "Tài khoản của bạn đã bị khóa bởi Admin!" });
        res.json({ success: true, message: "Thao tác thành công!" });
    } catch (err) {
        res.json({ success: false, message: "Lỗi server!" });
    }
});

app.post('/api/force-admin', async (req, res) => {
    const { targetUser } = req.body;
    try {
        await User.updateOne({ username: { $regex: new RegExp('^' + targetUser + '$', 'i') } }, { isAdmin: true });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topPlayers = await Leaderboard.find().sort({ kills: -1 }).limit(10);
        res.json(topPlayers.map(p => ({ name: p.username, kills: p.kills })));
    } catch (err) {
        res.json([]);
    }
});

// ==========================================
// SOCKET & QUẢN LÝ PHÒNG (CẬP NHẬT KILL VÀO MONGODB)
// ==========================================
const rooms = {}; 
io.on('connection', (socket) => {
    let currentRoomId = null;
    let playerName = "Khách";
    let isAdminPlayer = false;

    socket.on('setPlayerName', async (name) => { 
        playerName = name; 
        try {
            const user = await User.findOne({ username: name });
            if (user) isAdminPlayer = user.isAdmin;
        } catch (e) {}
    });

    socket.on('joinRoom', (data) => {
        const { roomId, mode } = data;
        if (!rooms[roomId]) rooms[roomId] = { mode: mode, players: {} };
        else data.mode = rooms[roomId].mode; 
        
        currentRoomId = roomId;
        socket.join(roomId);
        rooms[roomId].players[socket.id] = {
            x: (Math.random() - 0.5) * 100, y: 150, z: (Math.random() - 0.5) * 100,
            rotationY: 0, isArmed: true, hp: 100, name: playerName, kills: 0, isAdmin: isAdminPlayer
        };
        socket.emit('currentPlayers', { players: rooms[roomId].players, mode: rooms[roomId].mode });
        socket.to(roomId).emit('newPlayer', { id: socket.id, player: rooms[roomId].players[socket.id] });
    });

    socket.on('updatePosition', (data) => {
        if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].players[socket.id]) {
            const p = rooms[currentRoomId].players[socket.id];
            p.x = data.x; p.y = data.y; p.z = data.z;
            p.rotationY = data.rotationY; p.isArmed = data.isArmed;
            socket.to(currentRoomId).emit('playerMoved', { id: socket.id, player: p });
        }
    });

    // XỬ LÝ BẮN VÀ LƯU KILL VÀO MONGODB
    socket.on('shootPlayer', async (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const { targetId, isHeadshot, damage } = data;
        if (room.players[targetId] && room.players[targetId].hp > 0) {
            room.players[targetId].hp -= (isHeadshot ? 100 : damage);
            if (room.players[targetId].hp <= 0) {
                room.players[targetId].hp = 0;
                
                if (room.players[socket.id] && playerName !== "Khách") {
                    room.players[socket.id].kills++;
                    try {
                        // Cập nhật Kill và Headshot cho người bắn
                        await User.updateOne({ username: playerName }, { 
                            $inc: { kills: 1, headshots: isHeadshot ? 1 : 0 } 
                        });
                        // Cập nhật Bảng Xếp Hạng
                        await Leaderboard.updateOne(
                            { username: playerName },
                            { $inc: { kills: 1 } },
                            { upsert: true } 
                        );
                    } catch (err) { console.log("Lỗi cập nhật DB:", err); }
                }

                let killerNameStr = room.players[socket.id] && room.players[socket.id].name ? room.players[socket.id].name : "Ai đó";
                io.to(currentRoomId).emit('playerDied', { 
                    id: targetId, isHeadshot: isHeadshot, killerId: socket.id,
                    killerName: killerNameStr, victimName: room.players[targetId].name
                });
                
                setTimeout(() => {
                    if (room.players[targetId]) {
                        room.players[targetId].hp = 100; 
                        room.players[targetId].x = (Math.random() - 0.5) * 200; 
                        room.players[targetId].z = (Math.random() - 0.5) * 200;
                        io.to(currentRoomId).emit('playerRespawned', { id: targetId, player: room.players[targetId] });
                    }
                }, 3000);
            } else {
                io.to(currentRoomId).emit('hpUpdated', { id: targetId, hp: room.players[targetId].hp });
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            delete rooms[currentRoomId].players[socket.id];
            io.to(currentRoomId).emit('playerDisconnected', socket.id);
            if (Object.keys(rooms[currentRoomId].players).length === 0) delete rooms[currentRoomId]; 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});