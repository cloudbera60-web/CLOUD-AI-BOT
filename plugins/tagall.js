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
          { id: 'btn_tag_all_pro', text: '👥 Tag Everyone' },
          { id: 'btn_tag_admins_pro', text: '👑 Tag Admins Only' },
          { id: 'btn_tag_regular', text: '👤 Tag Regular Members' },
          { id: 'btn_tag_custom_msg', text: '✏️ Custom Message' },
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

// Tag handler function
async function handleGroupTag(type, data, m, sock) {
  try {
    let targetParticipants = [];
    let tagType = '';
    
    switch(type) {
      case 'all':
        targetParticipants = data.participants;
        tagType = 'All Members';
        break;
      case 'admins':
        targetParticipants = data.admins;
        tagType = 'Administrators';
        break;
      case 'regular':
        targetParticipants = data.regularMembers;
        tagType = 'Regular Members';
        break;
      default:
        return m.reply('❌ Invalid tag type.');
    }
    
    if (targetParticipants.length === 0) {
      return m.reply(`❌ No ${tagType.toLowerCase()} found to tag.`);
    }
    
    // Show processing
    await m.reply(`⏳ *Preparing Tag Operation*\n\n` +
      `📊 **Target:** ${tagType}\n` +
      `👥 **Count:** ${targetParticipants.length}\n` +
      `🏷️ **Group:** ${data.metadata.subject}\n` +
      `⏱️ **Status:** Processing...`);
    
    // Create mentions array
    const mentions = targetParticipants.map(p => p.id);
    
    // Generate tag message
    const currentTime = new Date().toLocaleTimeString('en-KE', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'Africa/Nairobi'
    });
    
    const tagMessage = `🔔 *${tagType.toUpperCase()} NOTIFICATION*\n\n` +
                      `📢 **Announcement from:** @${m.sender.split('@')[0]}\n` +
                      `🏷️ **Group:** ${data.metadata.subject}\n` +
                      `👥 **Affected:** ${targetParticipants.length} members\n` +
                      `🕐 **Time:** ${currentTime} (EAT)\n\n` +
                      `*Please acknowledge this message:*\n\n` +
                      mentions.map((mention, index) => 
                        `@${mention.split('@')[0]}${(index + 1) % 5 === 0 ? '\n' : ' '}`
                      ).join('') +
                      `\n\n📌 *End of Notification*\n` +
                      `✅ Powered by CLOUD AI Group Manager`;
    
    // Send tagged message
    await sock.sendMessage(m.from, {
      text: tagMessage,
      mentions: mentions
    }, { quoted: m });
    
  } catch (error) {
    console.error('❌ Tag Operation Error:', error);
    m.reply('❌ Failed to complete tagging operation. Please check permissions.');
  }
}
