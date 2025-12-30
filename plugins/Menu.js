const moment = require('moment-timezone');
const { sendButtons } = require('gifted-btns');

const menu = async (m, gss) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const mode = process.env.BOT_MODE === 'public' ? 'public' : 'private';
  const pref = prefix;

  const validCommands = ['list', 'help', 'menu'];

  if (validCommands.includes(cmd)) {
    // Get time-based greeting
    const time2 = moment().tz("Africa/Nairobi").format("HH:mm:ss");
    let pushwish = "";
    if (time2 < "05:00:00") {
      pushwish = `Good Night 🌙`;
    } else if (time2 < "11:00:00") {
      pushwish = `Good Morning 🌄`;
    } else if (time2 < "15:00:00") {
      pushwish = `Good Afternoon 🌤️`;
    } else if (time2 < "18:00:00") {
      pushwish = `Good Evening 🌇`;
    } else {
      pushwish = `Good Night 🌙`;
    }

    // Bot uptime
    const uptime = process.uptime();
    const day = Math.floor(uptime / (24 * 3600));
    const hours = Math.floor((uptime % (24 * 3600)) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const mainMenu = `
╭───「 ☁️ *CLOUD AI* 」───✧
│🎖️ Owner : *BERA TECH*
│👤 User : *${m.pushName}*
│⚡ Baileys : *Multi Device*
│💻 Type : *NodeJs*
│🌐 Mode : *${mode}*
│🔧 Prefix : [${prefix}]
│📦 Version : *4.0.0*
╰───────────────✧

> ${pushwish} *${m.pushName}*!

Choose an option below:`;

    try {
      // Send menu with buttons
      await sendButtons(gss, m.from, {
        title: '☁️ CLOUD AI Menu',
        text: mainMenu,
        footer: `📞 Contact: ${process.env.OWNER_NUMBER || '254116763755'} | ✉️ beratech00@gmail.com`,
        buttons: [
          { id: 'btn_menu', text: '📋 Main Menu' },
          { id: 'btn_ping', text: '🏓 Ping Test' },
          { id: 'btn_play', text: '🎵 Play Music' },
          { id: 'btn_owner', text: '👑 Owner Info' },
          { id: 'btn_plugins', text: '📦 Plugins' },
          { id: 'btn_status', text: '📊 Bot Status' }
        ]
      });

      console.log(`✅ Button menu sent to ${m.sender}`);
    } catch (error) {
      console.error('Error sending button menu:', error);
      // Fallback to text menu
      await gss.sendMessage(m.from, {
        image: { url: process.env.MENU_IMAGE || 'https://files.catbox.moe/6cp3vb.jpg' },
        caption: mainMenu,
        contextInfo: {
          mentionedJid: [m.sender]
        }
      }, { quoted: m });
    }
  }
};

module.exports = menu;
