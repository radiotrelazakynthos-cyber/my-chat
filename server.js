const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Μνήμη του server
let messages = [];
let onlineUsers = {}; 

// Αρχείο για μόνιμα Bans
const BANS_FILE = path.join(__dirname, 'bans.json');
let bannedData = { ips: [], tokens: [] };

if (fs.existsSync(BANS_FILE)) {
    bannedData = JSON.parse(fs.readFileSync(BANS_FILE));
}

let bannedIPs = new Set(bannedData.ips);
let bannedTokens = new Set(bannedData.tokens);

function saveBans() {
    fs.writeFileSync(BANS_FILE, JSON.stringify({ ips: Array.from(bannedIPs), tokens: Array.from(bannedTokens) }));
}

// Ο ΜΥΣΤΙΚΟΣ ΣΟΥ ΚΩΔΙΚΟΣ
const ADMIN_PASSWORD = "sakis019630";

// Συνάρτηση που βρίσκει την πραγματική IP του χρήστη στο Render
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

// Έλεγχος αν μια συσκευή ή IP έχει φάει Ban
function isBanned(req, token) {
    const ip = getClientIP(req);
    if (bannedIPs.has(ip)) return true;
    if (token && bannedTokens.has(token)) return true;
    return false;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint για είσοδο και έλεγχο δικαιωμάτων / Ban
app.post('/api/login', (req, res) => {
    const { loginString, token } = req.body;
    const ip = getClientIP(req);

    if (isBanned(req, token)) {
        return res.json({ success: false, error: 'banned' });
    }

    let username = loginString.trim();
    let isAdmin = false;

    // Έλεγχος αν έβαλε τον κωδικό διαχειριστή
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

app.get('/api/messages', (req, res) => {
    const requestingUser = req.query.user;
    const token = req.query.token;

    if (isBanned(req, token)) {
        return res.status(403).json({ error: 'Banned' });
    }

    if (!requestingUser) return res.json(messages.filter(m => !m.to)); 

    const filteredMessages = messages.filter(m => {
        return !m.to || m.user === requestingUser || m.to === requestingUser;
    });

    res.json(filteredMessages);
});

app.post('/api/messages', (req, res) => {
    const { user, text, image, to, avatar, token } = req.body;
    
    if (isBanned(req, token)) {
        return res.status(403).json({ error: 'Banned' });
    }

    if (!user) return res.status(400).json({ error: 'Missing user' });

    const newMessage = {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        user,
        avatar: avatar || null,
        text: text || "",
        image: image || null,
        to: to || null, 
        timestamp: Date.now()
    };

    messages.push(newMessage);
    
    if (avatar && onlineUsers[user]) {
        onlineUsers[user].avatar = avatar;
    }
    
    if (messages.length > 100) messages.shift(); 

    res.status(201).json(newMessage);
});

app.post('/api/presence', (req, res) => {
    const { user, avatar, token } = req.body;
    const ip = getClientIP(req);

    if (isBanned(req, token)) return res.sendStatus(403);

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
    const cutoff = Date.now() - 20000; 
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

// 🔥 ΤΟ ΚΟΥΜΠΙ ΤΟΥ BAN (Μόνο για τον Admin)
app.post('/api/ban', (req, res) => {
    const { targetUser, adminName } = req.body;

    if (adminName !== 'sakis') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const targetData = onlineUsers[targetUser];
    if (targetData) {
        if (targetData.ip) bannedIPs.add(targetData.ip);
        if (targetData.token) bannedTokens.add(targetData.token);
        
        saveBans(); // Αποθήκευση στο αρχείο
        delete onlineUsers[targetUser];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// 🔥 ΝΕΟ: UNBAN (Ξεμπανάρισμα)
app.post('/api/unban', (req, res) => {
    const { identifier, adminName } = req.body;
    if (adminName !== 'sakis') return res.status(403).json({ error: 'Unauthorized' });
    
    bannedIPs.delete(identifier);
    bannedTokens.delete(identifier);
    saveBans(); // Ενημέρωση αρχείου
    res.json({ success: true });
});

// 🔥 ΝΕΟ: ΛΙΣΤΑ BANS (Για το Panel σου)
app.get('/api/banned-list', (req, res) => {
    res.json({ ips: Array.from(bannedIPs), tokens: Array.from(bannedTokens) });
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