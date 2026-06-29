const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "1234"; 

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Κρατάμε τους χρήστες και τα timeouts για τα refresh τους
let activeUsers = new Set();
let disconnectTimeouts = {};
let messageHistory = [];

io.on('connection', (socket) => {
    let myUsername = null;

    socket.emit('chat-history', messageHistory);

    socket.on('register-user', (username) => {
        myUsername = username;
        
        // Αν υπήρχε timeout διαγραφής για αυτόν τον χρήστη (λόγω refresh), το ακυρώνουμε
        if (disconnectTimeouts[username]) {
            clearTimeout(disconnectTimeouts[username]);
            delete disconnectTimeouts[username];
        }
        
        activeUsers.add(username);
        io.emit('update-users', Array.from(activeUsers));
    });

    socket.on('send-message', (data) => {
        if (!myUsername) return;

        const msgObject = {
            id: Date.now() + Math.random().toString(36).substr(2, 5),
            user: myUsername,
            text: data.text || "",
            image: data.image || null,
            timestamp: Date.now()
        };

        messageHistory.push(msgObject);
        if (messageHistory.length > 50) messageHistory.shift();

        io.emit('new-message', msgObject);
    });

    socket.on('admin-delete-message', (data) => {
        if (data.password === ADMIN_PASSWORD) {
            messageHistory = messageHistory.filter(msg => msg.id !== data.msgId);
            io.emit('chat-history', messageHistory);
        }
    });

    socket.on('admin-clear-chat', (data) => {
        if (data.password === ADMIN_PASSWORD) {
            messageHistory = [];
            io.emit('chat-history', messageHistory);
        }
    });

    socket.on('disconnect', () => {
        if (myUsername) {
            // Αντί να τον σβήσουμε αμέσως, περιμένουμε 5 δευτερόλεπτα μήπως έκανε refresh
            disconnectTimeouts[myUsername] = setTimeout(() => {
                activeUsers.delete(myUsername);
                io.emit('update-users', Array.from(activeUsers));
                delete disconnectTimeouts[myUsername];
            }, 5000); 
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});