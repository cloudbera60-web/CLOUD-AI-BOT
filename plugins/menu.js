const { sendButtons } = require('gifted-btns');
const moment = require('moment-timezone');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  
  const validCommands = ['menu', 'help', 'start', 'list'];
  
  if (validCommands.includes(cmd)) {
    try {
      // Get time-based greeting with Kenyan timezone
      const nairobiTime = moment().tz("Africa/Nairobi");
      const currentHour = nairobiTime.hour();
      
      let greeting = "";
      let greetingEmoji = "";
      
      if (currentHour < 5) {
        greeting = "Late Night Serenity";
        greetingEmoji = "🌙✨";
      } else if (currentHour < 12) {
        greeting = "Morning Precision";
        greetingEmoji = "☀️⚡";
      } else if (currentHour < 17) {
        greeting = "Afternoon Efficiency";
        greetingEmoji = "⛅🚀";
      } else if (currentHour < 21) {
        greeting = "Evening Excellence";
        greetingEmoji = "🌇🌟";
      } else {
        greeting = "Night Innovation";
        greetingEmoji = "🌌💫";
      }
      
      // Format time nicely
      const formattedTime = nairobiTime.format('h:mm A');
      const formattedDate = nairobiTime.format('ddd, MMM D');
      
      // Create premium menu text
      const menuText = `╭───「 *CLOUD AI* 」───╮
│
│   ${greetingEmoji} *${greeting}*, ${m.pushName}!
│   📅 ${formattedDate} │ 🕐 ${formattedTime} (EAT)
│
│   ┌─「 *Quick Stats* 」
│   │  • User: @${m.sender.split('@')[0]}
│   │  • Prefix: ${prefix}
│   │  • Status: ✅ Operational
│   └─────────────
│
│   *Select a module below:*
╰─────────────────╯`;

      // Send premium button menu
      await sendButtons(sock, m.from, {
        title: '☁️ CLOUD AI | Professional Suite',
        text: menuText,
        footer: `Powered by BERA TECH | © ${new Date().getFullYear()} | v4.0.0`,
        buttons: [
          { id: 'btn_core_ping', text: '⚡ Performance' },
          { id: 'btn_core_owner', text: '👑 Owner Suite' },
          { id: 'btn_music_play', text: '🎵 Media Center' },
          { id: 'btn_tools_vcf', text: '📇 Export Tools' },
          { id: 'btn_group_tagall', text: '🏷️ Group Manager' },
          { id: 'btn_system_status', text: '📊 System Info' }
        ]
      });
      
      // Send audio notification (optional)
      try {
        await sock.sendMessage(m.from, {
          audio: { url: 'https://files.catbox.moe/x1q2w3.mp3' },
          mimetype: 'audio/mp4',
          ptt: false
        }, { quoted: m });
      } catch (audioError) {
        // Silent fail for audio
      }
      
      console.log(`✅ Premium menu sent to ${m.sender}`);
    } catch (error) {
      console.error('❌ Menu Error:', error);
      
      // Premium fallback text menu
      const fallbackMenu = `
╭───「 ☁️ *CLOUD AI* 」───╮
│
│   ⚡ *Premium Features*
│
│   ┌─「 Core Modules 」
│   │  • ${prefix}ping - System Performance
│   │  • ${prefix}owner - Owner Contact Suite
│   │  • ${prefix}play - Media Center
│   └─────────────
│
│   ┌─「 Group Tools 」
│   │  • ${prefix}vcf - Contact Exporter
│   │  • ${prefix}tagall - Member Manager
│   │  • ${prefix}url - File Processor
│   └─────────────
│
│   ┌─「 System 」
│   │  • ${prefix}status - System Info
│   │  • ${prefix}plugins - Installed Modules
│   │  • ${prefix}privacy - Settings (Owner)
│   └─────────────
│
│   📍 *Professional WhatsApp Automation*
│   👑 BERA TECH | v4.0.0
╰─────────────────╯`;
      
      await sock.sendMessage(m.from, {
        image: { url: 'https://files.catbox.moe/6cp3vb.jpg' },
        caption: fallbackMenu,
        contextInfo: {
          mentionedJid: [m.sender],
          forwardingScore: 999,
          isForwarded: true
        }
      }, { quoted: m });
    }
  }
};
