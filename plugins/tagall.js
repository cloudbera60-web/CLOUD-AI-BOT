const config = require('../../config.cjs');
const { sendButtons } = require('gifted-btns');

const tagall = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'tagall' || cmd === 'mentionall') {
    try {
      // Check if it's a group
      if (!m.isGroup) {
        return m.reply('❌ This command only works in groups!');
      }
      
      // Check if user is admin
      const groupMetadata = await sock.groupMetadata(m.from);
      const participant = groupMetadata.participants.find(p => p.id === m.sender);
      const botParticipant = groupMetadata.participants.find(p => p.id === sock.user.id);
      
      if (!participant?.admin) {
        return m.reply('❌ Only group admins can use this command!');
      }
      
      if (!botParticipant?.admin) {
        return m.reply('❌ I need to be admin to tag everyone!');
      }
      
      const participants = groupMetadata.participants;
      
      // Show tag options with buttons
      await sendButtons(sock, m.from, {
        title: '🏷️ Tag All Members',
        text: `Group: ${groupMetadata.subject}\nMembers: ${participants.length}\n\nSelect tagging option:`,
        footer: 'Admins Only | CLOUD AI',
        buttons: [
          { id: 'btn_tag_all', text: '👥 Tag Everyone' },
          { id: 'btn_tag_admins', text: '👑 Tag Admins' },
          { id: 'btn_tag_custom', text: '✏️ Custom Message' },
          { id: 'btn_tag_cancel', text: '❌ Cancel' }
        ]
      });
      
      // Store group data for button handling
      m.tagData = { metadata: groupMetadata, participants };
      
    } catch (error) {
      console.error('TagAll Error:', error);
      m.reply('❌ Error fetching group information.');
    }
  }
};

// Button handler for TagAll
const handleTagAllButton = async (m, sock, buttonId, tagData) => {
  if (!tagData) return m.reply('❌ Session expired. Please run .tagall again.');
  
  const { metadata, participants } = tagData;
  
  switch(buttonId) {
    case 'btn_tag_all':
      await tagEveryone(m, sock, participants, '👥 *Everyone!*');
      break;
      
    case 'btn_tag_admins':
      const admins = participants.filter(p => p.admin);
      await tagEveryone(m, sock, admins, '👑 *Admins!*');
      break;
      
    case 'btn_tag_custom':
      await requestCustomMessage(m, sock, participants);
      break;
      
    case 'btn_tag_cancel':
      await m.reply('✅ Tagging cancelled.');
      break;
  }
};

async function tagEveryone(m, sock, participants, message) {
  try {
    await m.reply(`⏳ Tagging ${participants.length} members...`);
    
    const mentions = participants.map(p => p.id);
    const tagMessage = `${message}\n\n` + 
                      participants.map(p => `@${p.id.split('@')[0]}`).join(' ') + 
                      `\n\n🏷️ Tagged by: @${m.sender.split('@')[0]}\n📅 ${new Date().toLocaleDateString()}`;
    
    await sock.sendMessage(m.from, {
      text: tagMessage,
      mentions: mentions
    }, { quoted: m });
    
  } catch (error) {
    console.error('Tag Error:', error);
    m.reply('❌ Error tagging members.');
  }
}

async function requestCustomMessage(m, sock, participants) {
  // Store participants and ask for custom message
  m.customTagData = { participants };
  
  await sendButtons(sock, m.from, {
    title: '✏️ Custom Tag Message',
    text: `Members: ${participants.length}\n\nPlease send your custom message now.\nUse {count} for member count, {time} for current time.`,
    footer: 'I will add mentions automatically',
    buttons: [
      { id: 'btn_tag_default', text: '🔄 Use Default' },
      { id: 'btn_tag_cancel', text: '❌ Cancel' }
    ]
  });
}

// Handler for custom tag messages
const handleCustomTag = async (m, sock) => {
  if (m.customTagData) {
    const { participants } = m.customTagData;
    const customMessage = m.body;
    
    const finalMessage = customMessage
      .replace(/{count}/g, participants.length)
      .replace(/{time}/g, new Date().toLocaleTimeString())
      .replace(/{date}/g, new Date().toLocaleDateString());
    
    await tagEveryone(m, sock, participants, finalMessage);
    
    // Clear custom data
    delete m.customTagData;
  }
};

module.exports = tagall;