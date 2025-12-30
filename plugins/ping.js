const ping = async (m, Matrix) => {
  const prefix = process.env.BOT_PREFIX || '.';
  
  // Extract command from body or handle button clicks
  let cmd = '';
  if (m.body && m.body.startsWith(prefix)) {
    cmd = m.body.slice(prefix.length).split(' ')[0].toLowerCase();
  }
  
  // Also handle button clicks that might come as commands
  if (m.cmd === 'ping' || cmd === "ping" || m.body === "btn_ping" || m.body === "🏓 Ping Test") {
    const start = new Date().getTime();

    const reactionEmojis = ['☁️', '⚡', '🚀', '💨', '🎯', '🎉', '🌟', '💥', '🕐', '🔹'];
    const textEmojis = ['💎', '🏆', '⚡️', '🚀', '🎶', '🌠', '🌀', '🔱', '🛡️', '✨'];

    const reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
    let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];

    while (textEmoji === reactionEmoji) {
      textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
    }

    await m.React(textEmoji);

    const end = new Date().getTime();
    const responseTime = (end - start) / 1000;

    const text = `☁️ *CLOUD AI SPEED: ${responseTime.toFixed(2)}ms ${reactionEmoji}*\n\n` +
                 `⏱️ Response: ${responseTime.toFixed(2)} seconds\n` +
                 `💡 From: ${m.pushName || 'User'}\n` +
                 `📊 Status: ${responseTime < 0.5 ? 'Excellent ⚡' : 'Good ✅'}`;

    await Matrix.sendMessage(m.from, {
      text,
      contextInfo: {
        mentionedJid: [m.sender]
      }
    }, { quoted: m });
    
    // Also send to button handler if needed
    return true;
  }
  
  return false;
};

module.exports = ping;
