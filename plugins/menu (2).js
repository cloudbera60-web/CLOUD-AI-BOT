const moment = require('moment-timezone');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

const menu = async (m, gss) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const mode = process.env.BOT_MODE === 'public' ? 'public' : 'private';
  const pref = prefix;

  const validCommands = ['list', 'help', 'menu'];

  if (validCommands.includes(cmd)) {
    // Get time-based greeting
    const time2 = moment().tz("Asia/Colombo").format("HH:mm:ss");
    let pushwish = "";
    if (time2 < "05:00:00") {
      pushwish = `Good Morning 🌄`;
    } else if (time2 < "11:00:00") {
      pushwish = `Good Morning 🌄`;
    } else if (time2 < "15:00:00") {
      pushwish = `Good Afternoon 🌤️`;
    } else if (time2 < "18:00:00") {
      pushwish = `Good Evening 🌇`;
    } else if (time2 < "19:00:00") {
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
╭───「 *${process.env.BOT_NAME || 'CLOUD AI'}* 」───✧
│🎖️ Owner : *${process.env.OWNER_NAME || 'BERA TECH'}*
│👤 User : *${m.pushName}*
│⚡ Baileys : *Multi Device*
│💻 Type : *NodeJs*
│🌐 Mode : *${mode}*
│📱 Platform : *${os.platform()}*
│🔧 Prefix : [${prefix}]
│📦 Version : *3.1.0*
╰───────────────✧

> ${pushwish} *${m.pushName}*!

╭───「 *Menu List* 」───✧
│📥 1. Download Menu      
│🔄 2. Converter Menu        
│🤖 3. AI Menu  
│🔧 4. Tools Menu  
│👥 5. Group Menu 
│🔍 6. Search Menu   
│🏠 7. Main Menu
│👑 8. Owner Menu 
│👀 9. Stalk Menu     
│📢 update
╰───────────────✧
> *Reply with the number (1-9)*`;

    try {
      // Send menu with image
      await gss.sendMessage(m.from, {
        image: { url: process.env.MENU_IMAGE || 'https://gitcdn.giftedtech.co.ke/image/AZO_image.jpg' },
        caption: mainMenu,
        contextInfo: {
          mentionedJid: [m.sender],
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363398040175935@newsletter',
            newsletterName: "JawadTechX",
            serverMessageId: 143
          }
        }
      }, {
        quoted: m
      });

      // Send audio
      await gss.sendMessage(m.from, {
        audio: { url: 'https://github.com/XdTechPro/KHAN-DATA/raw/refs/heads/main/autovoice/menunew.m4a' },
        mimetype: 'audio/mp4',
        ptt: true
      }, { quoted: m });

      console.log(`✅ Menu sent to ${m.sender}`);
    } catch (error) {
      console.error('Error sending menu:', error);
      await m.reply('Error sending menu. Please try again.');
    }
  }
};

module.exports = menu;
