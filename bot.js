[13/04/2026 20:47] Massi Haddad: const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// ========================
// CONFIGURATION
// ========================
const TELEGRAM_TOKEN = '8736598433:AAFNhEu9FkKbw5V3veb9AAulr4Y8EELoa6k';
const GROQ_API_KEY = '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';

// ========================
// INITIALISATION
// ========================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const groq = new Groq({ apiKey: GROQ_API_KEY });
const db = new Database('assistant.db');

// ========================
// BASE DE DONNÉES
// ========================
db.exec(
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
);

// ========================
// MÉMOIRE CONVERSATION
// ========================
const conversationHistory = {};

function getHistory(chatId) {
  if (!conversationHistory[chatId]) {
    conversationHistory[chatId] = [];
  }
  return conversationHistory[chatId];
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Garde seulement les 20 derniers messages
  if (history.length > 20) history.shift();
}

// ========================
// APPEL IA GROQ
// ========================
async function askGroq(chatId, userMessage) {
  const history = getHistory(chatId);
  
  // Récupère la mémoire personnelle
  const memories = db.prepare('SELECT key, value FROM memory WHERE chat_id = ?').all(chatId);
  const memoryText = memories.length > 0 
    ? '\nInformations mémorisées sur cet utilisateur:\n' + memories.map(m => - ${m.key}: ${m.value}).join('\n')
    : '';

  const systemPrompt = Tu es un assistant personnel intelligent et amical, comme un ami de confiance. 
Tu aides l'utilisateur à ne rien oublier, à gérer ses rappels et ses tâches quotidiennes.
Tu parles de façon naturelle, chaleureuse et directe.
Tu peux créer des rappels quand l'utilisateur te le demande.

Pour créer un rappel, réponds EXACTEMENT avec ce format JSON sur une ligne séparée:
RAPPEL:{"message":"description du rappel","datetime":"YYYY-MM-DD HH:MM"}

Pour mémoriser une info importante, utilise:
MEMOIRE:{"key":"nom","value":"valeur"}

Date et heure actuelle: ${new Date().toLocaleString('fr-FR')}
${memoryText};

  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      max_tokens: 1024,
      temperature: 0.7
    });

    const response = completion.choices[0].message.content;
    addToHistory(chatId, 'user', userMessage);
    addToHistory(chatId, 'assistant', response);
    
    return response;
  } catch (error) {
    console.error('Erreur Groq:', error);
    return "Désolé, j'ai eu un problème. Réessaie dans un instant ! 🙏";
  }
}

// ========================
// TRAITEMENT RÉPONSE IA
// ========================
async function processAIResponse(chatId, aiResponse) {
[13/04/2026 20:47] Massi Haddad: let cleanResponse = aiResponse;
  
  // Vérifie si y'a un rappel à créer
  const reminderMatch = aiResponse.match(/RAPPEL:(\{[^}]+\})/);
  if (reminderMatch) {
    try {
      const reminderData = JSON.parse(reminderMatch[1]);
      db.prepare('INSERT INTO reminders (chat_id, message, remind_at) VALUES (?, ?, ?)')
        .run(chatId, reminderData.message, reminderData.datetime);
      cleanResponse = cleanResponse.replace(/RAPPEL:\{[^}]+\}/, '').trim();
      cleanResponse += \n\n⏰ Rappel créé pour le ${new Date(reminderData.datetime).toLocaleString('fr-FR')} !;
    } catch (e) {
      console.error('Erreur parsing rappel:', e);
    }
  }

  // Vérifie si y'a une info à mémoriser
  const memoryMatch = aiResponse.match(/MEMOIRE:(\{[^}]+\})/);
  if (memoryMatch) {
    try {
      const memData = JSON.parse(memoryMatch[1]);
      db.prepare('INSERT OR REPLACE INTO memory (chat_id, key, value) VALUES (?, ?, ?)')
        .run(chatId, memData.key, memData.value);
      cleanResponse = cleanResponse.replace(/MEMOIRE:\{[^}]+\}/, '').trim();
      cleanResponse += \n\n🧠 J'ai mémorisé : ${memData.key} = ${memData.value};
    } catch (e) {
      console.error('Erreur parsing mémoire:', e);
    }
  }

  return cleanResponse;
}

// ========================
// VÉRIFICATEUR DE RAPPELS
// ========================
cron.schedule('* * * * *', () => {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const dueReminders = db.prepare(
    'SELECT * FROM reminders WHERE remind_at <= ? AND done = 0'
  ).all(now);

  dueReminders.forEach(reminder => {
    bot.sendMessage(reminder.chat_id, 
      ⏰ *RAPPEL !*\n\n${reminder.message}\n\nC'est fait ? Réponds *oui* ou *non* !,
      { parse_mode: 'Markdown' }
    );
    db.prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(reminder.id);
  });
});

// ========================
// COMMANDES TELEGRAM
// ========================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'ami';
  
  bot.sendMessage(chatId, 
    👋 Salut ${firstName} ! Je suis ton assistant personnel intelligent !\n\n +
    Je suis là pour t'aider à :\n +
    📅 Ne rien oublier\n +
    ⏰ Te rappeler tes tâches\n +
    🧠 Mémoriser des infos importantes\n\n +
    Parle-moi naturellement, comme à un ami ! 😊\n\n +
    Commandes disponibles:\n +
    /rappels - Voir tes rappels\n +
    /memoire - Voir ce que je mémorise\n +
    /aide - Aide
  );
});

bot.onText(/\/rappels/, (msg) => {
  const chatId = msg.chat.id;
  const reminders = db.prepare(
    'SELECT * FROM reminders WHERE chat_id = ? AND done = 0 ORDER BY remind_at ASC'
  ).all(chatId);

  if (reminders.length === 0) {
    bot.sendMessage(chatId, '📅 Aucun rappel en attente ! Tout est bon 👍');
    return;
  }

  let text = '📅 *Tes rappels en attente :*\n\n';
  reminders.forEach((r, i) => {
    text += ${i + 1}. ${r.message}\n   🕐 ${new Date(r.remind_at).toLocaleString('fr-FR')}\n\n;
  });

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/memoire/, (msg) => {
  const chatId = msg.chat.id;
  const memories = db.prepare('SELECT * FROM memory WHERE chat_id = ?').all(chatId);

  if (memories.length === 0) {
    bot.sendMessage(chatId, "🧠 Je n'ai encore rien mémorisé sur toi !");
    return;
  }

  let text = '🧠 *Ce que je sais sur toi :*\n\n';
  memories.forEach(m => {
    text += • *${m.key}* : ${m.value}\n;
  });

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/aide/, (msg) => {
  bot.sendMessage(msg.chat.id,
    🤖 *Comment je fonctionne :*\n\n +
    Parle-moi naturellement !\n\n +
    *Exemples :*\n +
    • "Rappelle-moi d'appeler le médecin demain à 9h"\n +
    • "N'oublie pas que mon rendez-vous est vendredi"\n +
[13/04/2026 20:47] Massi Haddad: • "Mémorise que mon code wifi est 1234"\n +
    • "Qu'est-ce que j'ai prévu aujourd'hui ?"\n\n +
    *Commandes :*\n +
    /rappels - Voir tes rappels\n +
    /memoire - Voir tes infos mémorisées\n +
    /start - Redémarrer,
    { parse_mode: 'Markdown' }
  );
});

// ========================
// MESSAGE TEXTE PRINCIPAL
// ========================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  // Ignore les commandes
  if (msg.text && msg.text.startsWith('/')) return;
  
  // Ignore les vocaux pour l'instant (on les gère séparément)
  if (msg.voice) {
    bot.sendMessage(chatId, "🎤 Les messages vocaux arrivent bientôt ! Pour l'instant envoie un texte 😊");
    return;
  }

  if (!msg.text) return;

  // Indicateur de frappe
  bot.sendChatAction(chatId, 'typing');

  try {
    const aiResponse = await askGroq(chatId, msg.text);
    const finalResponse = await processAIResponse(chatId, aiResponse);
    
    bot.sendMessage(chatId, finalResponse, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Erreur:', error);
    bot.sendMessage(chatId, "Oups, une erreur s'est produite. Réessaie ! 🙏");
  }
});

// ========================
// DÉMARRAGE
// ========================
console.log('🤖 Bot assistant personnel démarré !');
console.log('✅ Connecté à Telegram');
console.log('✅ IA Groq activée');
console.log('✅ Vérification rappels toutes les minutes');
