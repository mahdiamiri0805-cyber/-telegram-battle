const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!BOT_TOKEN) {
  console.log("BOT_TOKEN تنظیم نشده است.");
}

if (!PUBLIC_URL) {
  console.log("PUBLIC_URL تنظیم نشده است.");
}

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const players = new Map();

function randomPosition() {
  return {
    x: 100 + Math.random() * 700,
    y: 100 + Math.random() * 400
  };
}

function createRoom() {
  const id = Math.random().toString(36).substring(2, 8).toUpperCase();

  rooms.set(id, {
    id,
    players: new Map(),
    started: false,
    winner: null
  });

  return id;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function roomState(room) {
  return {
    type: "state",
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      hp: p.hp
    })),
    started: room.started,
    winner: room.winner
  };
}

wss.on("connection", ws => {
  let currentPlayer = null;

  ws.on("message", message => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === "join") {
        const room = getRoom(data.room);

        if (!room) {
          send(ws, {
            type: "error",
            message: "اتاق پیدا نشد."
          });
          return;
        }

        if (room.players.size >= 4) {
          send(ws, {
            type: "error",
            message: "این اتاق پر است."
          });
          return;
        }

        const id = Math.random().toString(36).substring(2, 10);

        const position = randomPosition();

        const player = {
          id,
          name: String(data.name || "Player").substring(0, 20),
          x: position.x,
          y: position.y,
          hp: 100,
          ws
        };

        room.players.set(id, player);
        players.set(id, player);

        currentPlayer = player;

        if (room.players.size >= 2) {
          room.started = true;
        }

        send(ws, {
          type: "joined",
          id,
          room: room.id
        });

        broadcast(room, roomState(room));
      }

      if (data.type === "move" && currentPlayer) {
        const room = [...rooms.values()].find(r =>
          r.players.has(currentPlayer.id)
        );

        if (!room || currentPlayer.hp <= 0) return;

        const speed = 12;

        if (data.direction === "up") {
          currentPlayer.y -= speed;
        }

        if (data.direction === "down") {
          currentPlayer.y += speed;
        }

        if (data.direction === "left") {
          currentPlayer.x -= speed;
        }

        if (data.direction === "right") {
          currentPlayer.x += speed;
        }

        currentPlayer.x = Math.max(30, Math.min(870, currentPlayer.x));
        currentPlayer.y = Math.max(30, Math.min(570, currentPlayer.y));

        broadcast(room, roomState(room));
      }

      if (data.type === "shoot" && currentPlayer) {
        const room = [...rooms.values()].find(r =>
          r.players.has(currentPlayer.id)
        );

        if (!room || !room.started) return;

        const target = room.players.get(data.targetId);

        if (!target || target.id === currentPlayer.id) return;
        if (target.hp <= 0) return;

        const dx = currentPlayer.x - target.x;
        const dy = currentPlayer.y - target.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= 180) {
          target.hp -= 25;

          if (target.hp <= 0) {
            target.hp = 0;
          }

          const alive = [...room.players.values()]
            .filter(p => p.hp > 0);

          if (alive.length === 1 && room.players.size >= 2) {
            room.winner = alive[0].name;
          }

          broadcast(room, roomState(room));
        }
      }
    } catch (error) {
      console.log("Message error:", error);
    }
  });

  ws.on("close", () => {
    if (!currentPlayer) return;

    const room = [...rooms.values()].find(r =>
      r.players.has(currentPlayer.id)
    );

    if (room) {
      room.players.delete(currentPlayer.id);
      broadcast(room, roomState(room));

      if (room.players.size === 0) {
        rooms.delete(room.id);
      }
    }

    players.delete(currentPlayer.id);
  });
});

let bot;

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, {
    polling: true
  });

  bot.onText(/\/start/, msg => {
    const chatId = msg.chat.id;
    const name =
      msg.from.first_name ||
      "Player";

    const roomId = createRoom();

    const gameUrl =
      `${PUBLIC_URL}/?room=${roomId}` +
      `&user=${msg.from.id}` +
      `&name=${encodeURIComponent(name)}`;

    bot.sendMessage(
      chatId,
      "🎮 بازی آماده است!\n\nبرای ورود به بازی روی دکمه زیر بزن:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎮 ورود به بازی",
                web_app: {
                  url: gameUrl
                }
              }
            ]
          ]
        }
      }
    );
  });

  bot.onText(/\/room/, msg => {
    const chatId = msg.chat.id;
    const roomId = createRoom();

    bot.sendMessage(
      chatId,
      `🎮 اتاق جدید ساخته شد:\n\nکد اتاق: ${roomId}\n\nدوباره /start را بزن تا وارد بازی شوی.`
    );
  });

  console.log("Telegram bot is running...");
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
