const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // Σύνδεση με MongoDB
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Σύνδεση στη MongoDB μέσω της μεταβλητής MONGO_URI που βάλαμε στο Render
const MONGO_URI = process.env.MONGO_URI;
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('==> Επιτυχής σύνδεση στη MongoDB!'))
        .catch(err => console.error('Λάθος σύνδεσης MongoDB:', err));
} else {
    console.log('Προειδοποίηση: Δεν βρέθηκε το MONGO_URI. Τα δεδομένα θα χαθούν στην επανεκκίνηση.');
}

// Μοντέλο για τα Μηνύματα στη MongoDB
const MessageSchema = new mongoose.Schema({
    id: String,
    user: String,
    avatar: String,
    text: String,
    image: String,
    to: String,
    timestamp: { type: Number, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Μοντέλο για τα Bans στη MongoDB
const BanSchema = new mongoose.Schema({
    type: String, // 'ip' ή 'token'
    value: String
});
const Ban = mongoose.model('Ban', BanSchema);

// Μνήμη μόνο για τους online χρήστες (αυτοί χάνονται αν πέσει ο server, λογικό)
let onlineUsers = {}; 
const forbiddenNames = ["Admin", "Owner", "Boss"]; 
const ADMIN_PASSWORD = "sakis019630";

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

// Έλεγχος αν ο χρήστης είναι banned από τη βάση δεδομένων
async function isBanned(req, token) {
    const ip = getClientIP(req);
    const ipBan = await Ban.findOne({ type: 'ip', value: ip });
    if (ipBan) return true;
    
    if (token) {
        const tokenBan = await Ban.findOne({ type: 'token', value: token });
        if (tokenBan) return true;
    }
    return false;
}

app.get('/ping', (req, res) => res.status(200).send('ok'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// RESET (Μόνο για τον Sakis) - Διαγραφή από τη βάση
app.post('/api/clear-all', async (req, res) => {
    const { adminName } = req.body;
    if (adminName === "sakis") {
        await Message.deleteMany({});
        onlineUsers = {};
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false, error: "Μη εξουσιοδοτημένη ενέργεια" });
    }
});

app.post('/api/login', async (req, res) => {
    const { loginString, token } = req.body;

    if (await isBanned(req, token)) {
        return res.json({ success: false, error: 'banned' });
    }

    let username = loginString.trim();
    let isAdmin = false;

    if (forbiddenNames.includes(username)) {
        return res.json({ success: false, error: 'Απαγορευμένο όνομα' });
    }

    if (onlineUsers[username]) {
        return res.json({ success: false, error: 'Το όνομα χρησιμοποιείται ήδη' });
    }

    if (username.includes(':')) {
        const parts = username.split(':');
        const namePart = parts[0].trim();
        const passPart = parts[1].trim();

        if (namePart.toLowerCase() === 'sakis' && passPart === ADMIN_PASSWORD) {
            username = "sakis";
            isAdmin = true;
        }
    }

    res.json({ success: true, username, isAdmin });
});

// Λήψη μηνυμάτων από τη MongoDB
app.get('/api/messages', async (req, res) => {
    const requestingUser = req.query.user;
    const token = req.query.token;

    if (await isBanned(req, token)) {
        return res.status(403).json({ error: 'Banned' });
    }

    // Φέρνουμε τα τελευταία 50 μηνύματα από τη βάση
    const allMessages = await Message.find().sort({ timestamp: -1 }).limit(50);
    // Τα γυρνάμε στη σωστή χρονολογική σειρά
    const messages = allMessages.reverse();

    if (!requestingUser) return res.json(messages.filter(m => !m.to)); 

    const filteredMessages = messages.filter(m => {
        return !m.to || m.user === requestingUser || m.to === requestingUser;
    });

    res.json(filteredMessages);
});

// Αποθήκευση νέου μηνύματος στη MongoDB
app.post('/api/messages', async (req, res) => {
    const { user, text, image, to, avatar, token } = req.body;
    
    if (await isBanned(req, token)) {
        return res.status(403).json({ error: 'Banned' });
    }

    if (!user) return res.status(400).json({ error: 'Missing user' });

    const newMessage = new Message({
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        user,
        avatar: avatar || null,
        text: text || "",
        image: image || null,
        to: to || null, 
        timestamp: Date.now()
    });

    await newMessage.save();
    
    if (avatar && onlineUsers[user]) {
        onlineUsers[user].avatar = avatar;
    }
    
    res.status(201).json(newMessage);
});

app.post('/api/presence', async (req, res) => {
    const { user, avatar, token } = req.body;
    const ip = getClientIP(req);

    if (await isBanned(req, token)) return res.sendStatus(403);

    if (user) {
        onlineUsers[user] = {
            lastSeen: Date.now(),
            avatar: avatar || (onlineUsers[user] ? onlineUsers[user].avatar : ""),
            ip: ip,
            token: token || ""
        };
    }
    res.sendStatus(200);
});

app.get('/api/presence', (req, res) => {
    const cutoff = Date.now() - 30000; 
    const active = [];
    
    for (const [username, userData] of Object.entries(onlineUsers)) {
        if (userData.lastSeen > cutoff && !username.startsWith("Guest_")) {
            active.push({
                user: username,
                avatar: userData.avatar || ""
            });
        }
    }
    res.json(active);
});

// Προσθήκη Ban στη MongoDB
app.post('/api/ban', async (req, res) => {
    const { targetUser, adminName } = req.body;

    if (adminName !== 'sakis') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const targetData = onlineUsers[targetUser];
    if (targetData) {
        if (targetData.ip) {
            await Ban.findOneAndUpdate({ type: 'ip', value: targetData.ip }, { type: 'ip', value: targetData.ip }, { upsert: true });
        }
        if (targetData.token) {
            await Ban.findOneAndUpdate({ type: 'token', value: targetData.token }, { type: 'token', value: targetData.token }, { upsert: true });
        }
        
        delete onlineUsers[targetUser];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.post('/api/logout', (req, res) => {
    const { user } = req.body;
    if (user && onlineUsers[user]) {
        delete onlineUsers[user];
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`To chat τρέχει στη θύρα ${PORT}`);
});