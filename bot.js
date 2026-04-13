[13/04/2026 21:14] Massi Haddad: const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const cron = require('node-cron');
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

// ========================
// BASE DE DONNÉES JSON
// ========================
const DB_FILE = '/tmp/samybot_data.json';

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) {}
  return { reminders: [], memory: [] };
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    console.error('Erreur sauvegarde:', e);
  }
}

let dbData = loadDB();

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
  let cleanResponse = aiResponse;
  
  // Vérifie si y'a un rappel à créer
  const reminderMatch = aiResponse.match(/RAPPEL:(\{[^}]+\})/);
  if (reminderMatch) {
    try {
      const reminderData = JSON.parse(reminderMatch[1]);
      dbData = loadDB();
      dbData.reminders.push({
        id: Date.now(),
        chat_id: chatId,
[13/04/2026 21:14] Massi Haddad: message: reminderData.message,
        remind_at: reminderData.datetime,
        done: 0
      });
      saveDB(dbData);
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
      dbData = loadDB();
      const existing = dbData.memory.findIndex(m => m.chat_id === chatId && m.key === memData.key);
      if (existing >= 0) {
        dbData.memory[existing].value = memData.value;
      } else {
        dbData.memory.push({ chat_id: chatId, key: memData.key, value: memData.value });
      }
      saveDB(dbData);
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
  dbData = loadDB();
  const dueReminders = dbData.reminders.filter(r => r.remind_at <= now && r.done === 0);

  dueReminders.forEach(reminder => {
    bot.sendMessage(reminder.chat_id, 
      ⏰ *RAPPEL !*\n\n${reminder.message}\n\nC'est fait ? Réponds *oui* ou *non* !,
      { parse_mode: 'Markdown' }
    );
    reminder.done = 1;
  });
  
  if (dueReminders.length > 0) saveDB(dbData);
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
  dbData = loadDB();
  const reminders = dbData.reminders.filter(r => r.chat_id === chatId && r.done === 0)
    .sort((a, b) => a.remind_at.localeCompare(b.remind_at));

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
  dbData = loadDB();
  const memories = dbData.memory.filter(m => m.chat_id === chatId);

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
    • "Mémorise que mon code wifi est 1234"\n +
    • "Qu'est-ce que j'ai prévu aujourd'hui ?"\n\n +
    *Commandes :*\n +
    /rappels - Voir tes rappels\n +
    /memoire - Voir tes infos mémorisées\n +
    /start - Redémarrer,
    { parse_mode: 'Markdown' }
  );
});
[13/04/2026 21:14] Massi Haddad: // ========================
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
