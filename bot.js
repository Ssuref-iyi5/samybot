const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const cron = require('node-cron');
const fs = require('fs');

const TELEGRAM_TOKEN = '8736598433:AAFNhEu9FkKbw5V3veb9AAulr4Y8EELoa6k';
const GROQ_API_KEY = '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';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const groq = new Groq({ apiKey: GROQ_API_KEY });

const DB = '/tmp/data.json';
const history = {};

function load() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch(e) {}
  return { reminders: [], memory: [] };
}

function save(d) {
  try { fs.writeFileSync(DB, JSON.stringify(d)); } catch(e) {}
}

function getHistory(id) {
  if (!history[id]) history[id] = [];
  return history[id];
}

async function askAI(chatId, msg) {
  const h = getHistory(chatId);
  const d = load();
  const mem = d.memory.filter(m => m.chat_id === chatId);
  const memText = mem.length > 0 ? '\nMémoire: ' + mem.map(m => m.key + ': ' + m.value).join(', ') : '';

  const sys = `Tu es Samybot, un assistant personnel amical et intelligent.
Tu aides à gérer les rappels et mémoriser des infos importantes.
Pour créer un rappel utilise: RAPPEL:{"message":"texte","datetime":"YYYY-MM-DD HH:MM"}
Pour mémoriser: MEMOIRE:{"key":"nom","value":"valeur"}
Date actuelle: ${new Date().toLocaleString('fr-FR')}${memText}`;

  h.push({ role: 'user', content: msg });
  if (h.length > 10) h.shift();

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: sys }, ...h],
    max_tokens: 500
  });

  const reply = res.choices[0].message.content;
  h.push({ role: 'assistant', content: reply });
  return reply;
}

function process(chatId, text) {
  let out = text;
  const d = load();

  const r = text.match(/RAPPEL:(\{[^}]+\})/);
  if (r) {
    try {
      const data = JSON.parse(r[1]);
      d.reminders.push({ id: Date.now(), chat_id: chatId, message: data.message, remind_at: data.datetime, done: 0 });
      save(d);
      out = out.replace(/RAPPEL:\{[^}]+\}/, '').trim() + '\n\n⏰ Rappel créé !';
    } catch(e) {}
  }

  const m = text.match(/MEMOIRE:(\{[^}]+\})/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const idx = d.memory.findIndex(x => x.chat_id === chatId && x.key === data.key);
      if (idx >= 0) d.memory[idx].value = data.value;
      else d.memory.push({ chat_id: chatId, key: data.key, value: data.value });
      save(d);
      out = out.replace(/MEMOIRE:\{[^}]+\}/, '').trim() + '\n\n🧠 Mémorisé !';
    } catch(e) {}
  }

  return out;
}

cron.schedule('* * * * *', () => {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const d = load();
  let changed = false;
  d.reminders.forEach(r => {
    if (r.remind_at <= now && r.done === 0) {
      bot.sendMessage(r.chat_id, `⏰ *RAPPEL !*\n\n${r.message}`, { parse_mode: 'Markdown' });
      r.done = 1;
      changed = true;
    }
  });
  if (changed) save(d);
});

bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, `👋 Salut ! Je suis *Samybot*, ton assistant personnel !\n\nParle-moi naturellement 😊\n\n/rappels - Tes rappels\n/memoire - Tes infos`, { parse_mode: 'Markdown' });
});

bot.onText(/\/rappels/, msg => {
  const d = load();
  const list = d.reminders.filter(r => r.chat_id === msg.chat.id && r.done === 0);
  if (!list.length) return bot.sendMessage(msg.chat.id, '📅 Aucun rappel en attente !');
  bot.sendMessage(msg.chat.id, '📅 *Rappels:*\n\n' + list.map((r,i) => `${i+1}. ${r.message} - ${r.remind_at}`).join('\n'), { parse_mode: 'Markdown' });
});

bot.onText(/\/memoire/, msg => {
  const d = load();
  const list = d.memory.filter(m => m.chat_id === msg.chat.id);
  if (!list.length) return bot.sendMessage(msg.chat.id, '🧠 Rien de mémorisé !');
  bot.sendMessage(msg.chat.id, '🧠 *Mémoire:*\n\n' + list.map(m => `• ${m.key}: ${m.value}`).join('\n'), { parse_mode: 'Markdown' });
});

bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  bot.sendChatAction(chatId, 'typing');
  try {
    const reply = await askAI(chatId, msg.text);
    const final = process(chatId, reply);
    bot.sendMessage(chatId, final, { parse_mode: 'Markdown' });
  } catch(e) {
    console.error(e);
    bot.sendMessage(chatId, "Désolé, erreur ! Réessaie 🙏");
  }
});

console.log('🤖 Samybot démarré !');
