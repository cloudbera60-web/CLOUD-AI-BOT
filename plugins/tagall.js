const { sendButtons } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'tagall' || cmd === 'mention') {
    try {
      if (!m.isGroup) {
        return m.reply('❌ *Group Command Only*\nThis feature requires group context.');
      }
      
      const groupMetadata = await sock.groupMetadata(m.from);
      const participants = groupMetadata.participants;
      const participant = participants.find(p => p.id === m.sender);
      const botParticipant = participants.find(p => p.id === sock.user.id);
      
      // Permission checks
      if (!participant?.admin) {
        return m.reply('🔒 *Admin Required*\nOnly group administrators can use this feature.');
      }
      
      if (!botParticipant?.admin) {
        return m.reply('⚠️ *Bot Permission Required*\nI need admin rights to tag all members.');
      }
      
      const admins = participants.filter(p => p.admin);
      const regularMembers = participants.filter(p => !p.admin);
      
      await sendButtons(sock, m.from, {
        title: '🏷️ Professional Group Manager',
        text: `*Group Analysis Complete*\n\n` +
              `🏷️ **Group:** ${groupMetadata.subject}\n` +
              `📊 **Members:** ${participants.length}\n` +
              `👑 **Admins:** ${admins.length}\n` +
              `👤 **Regular:** ${regularMembers.length}\n` +
              `👤 **You:** ${participant.admin ? '👑 Admin' : '👤 Member'}\n\n` +
              `*Select tagging option:*`,
        footer: 'CLOUD AI Group Management | Professional Tagging',
        buttons: [
          { id: 'btn_tag_all', text: '👥 Tag Everyone' },
          { id: 'btn_tag_admins', text: '👑 Tag Admins Only' },
          { id: 'btn_tag_regular', text: '👤 Tag Regular Members' },
          { id: 'btn_tag_custom', text: '✏️ Custom Message' },
          { id: 'btn_tag_cancel', text: '❌ Cancel' }
        ]
      });
      
      // Store data
      m.groupManagerData = {
        metadata: groupMetadata,
        participants: participants,
        admins: admins,
        regularMembers: regularMembers
      };
      
    } catch (error) {
      console.error('❌ Group Manager Error:', error);
      m.reply('❌ Failed to analyze group. Please ensure proper permissions.');
    }
  }
};
