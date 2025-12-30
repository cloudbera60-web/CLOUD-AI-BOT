const { sendButtons, sendInteractiveMessage } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'owner') {
    try {
      // Premium Owner Contact Suite
      await sendInteractiveMessage(sock, m.from, {
        title: '👑 BERA TECH | Owner Suite',
        text: `*Premium Contact Management*\n\n` +
              `📊 **BERA TECH**\n` +
              `╭─「 Contact Channels 」\n` +
              `│  • Primary: +254116763755\n` +
              `│  • Secondary: +254743982206\n` +
              `│  • Email: beratech00@gmail.com\n` +
              `╰────────────────────\n\n` +
              `Select your preferred contact method:`,
        footer: 'CLOUD AI Professional Suite | Instant Connectivity',
        interactiveButtons: [
          {
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
              display_text: '📞 Call Primary',
              phone_number: '+254116763755'
            })
          },
          {
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
              display_text: '📞 Call Secondary',
              phone_number: '+254743982206'
            })
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '✉️ Compose Email',
              url: 'mailto:beratech00@gmail.com?subject=CLOUD%20AI%20Inquiry'
            })
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '💬 WhatsApp Chat',
              url: 'https://wa.me/254116763755?text=Hello%20BERA%20TECH%20-%20CLOUD%20AI%20User'
            })
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '🌐 Visit GitHub',
              url: 'https://github.com/beratech'
            })
          }
        ]
      });
      
      // Also send traditional vCard for compatibility
      setTimeout(async () => {
        const contactMsg = {
          contacts: {
            displayName: 'BERA TECH | Cloud AI Developer',
            contacts: [{
              displayName: 'BERA TECH',
              vcard: `BEGIN:VCARD\nVERSION:3.0\nN:TECH;BERA;;;\nFN:BERA TECH\nORG:Cloud AI Development;\nTEL;TYPE=WORK,VOICE:+254116763755\nTEL;TYPE=CELL:+254743982206\nEMAIL;TYPE=WORK:beratech00@gmail.com\nURL;TYPE=GITHUB:https://github.com/beratech\nNOTE:CLOUD AI WhatsApp Bot Developer\nEND:VCARD`
            }]
          }
        };
        
        await sock.sendMessage(m.from, contactMsg, { quoted: m });
      }, 1000);
      
      await m.React("👑");
      
    } catch (error) {
      console.error('❌ Owner Suite Error:', error);
      
      // Fallback to simple text
      await sock.sendMessage(m.from, {
        text: `*👑 BERA TECH Contact Suite*\n\n` +
              `📞 **Phone Numbers:**\n` +
              `• Primary: +254116763755\n` +
              `• Secondary: +254743982206\n\n` +
              `✉️ **Email:** beratech00@gmail.com\n\n` +
              `🌐 **GitHub:** https://github.com/beratech\n\n` +
              `_Tap numbers to call or copy_`,
        contextInfo: { mentionedJid: [m.sender] }
      }, { quoted: m });
    }
  }
};
