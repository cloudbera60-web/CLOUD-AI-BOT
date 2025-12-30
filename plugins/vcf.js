const fs = require('fs').promises;
const path = require('path');
const { sendButtons } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'vcf') {
    try {
      if (!m.isGroup) {
        return m.reply('❌ *Group Command Only*\nThis feature requires a group context.');
      }
      
      const groupMetadata = await sock.groupMetadata(m.from);
      const participants = groupMetadata.participants;
      const admins = participants.filter(p => p.admin);
      
      await sendButtons(sock, m.from, {
        title: '📇 Professional Contact Export',
        text: `*Group Analysis Complete*\n\n` +
              `🏷️ **Group:** ${groupMetadata.subject}\n` +
              `👥 **Total Members:** ${participants.length}\n` +
              `👑 **Administrators:** ${admins.length}\n` +
              `📅 **Created:** ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}\n\n` +
              `*Select export format:*`,
        footer: 'CLOUD AI Contact Management | VCF vCard Format',
        buttons: [
          { id: 'btn_vcf_all', text: '📋 Export All Contacts' },
          { id: 'btn_vcf_admins', text: '👑 Export Admins Only' },
          { id: 'btn_vcf_custom', text: '⚙️ Custom Selection' },
          { id: 'btn_vcf_cancel', text: '❌ Cancel Export' }
        ]
      });
      
      // Store data for button handlers
      m.exportData = {
        metadata: groupMetadata,
        participants: participants,
        admins: admins
      };
      
    } catch (error) {
      console.error('❌ VCF Export Error:', error);
      m.reply('❌ Failed to analyze group. Please ensure I have admin permissions.');
    }
  }
};
