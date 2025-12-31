
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
      
      // Get group metadata
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
      m.vcfData = {
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

// Export function for bot-runner.js to use
async function exportVCF(m, sock, type, data) {
  try {
    const { metadata, participants, admins } = data;
    let exportParticipants = [];
    let exportType = '';
    
    switch(type) {
      case 'all':
        exportParticipants = participants;
        exportType = 'All Contacts';
        break;
      case 'admins':
        exportParticipants = admins;
        exportType = 'Administrators Only';
        break;
      default:
        return m.reply('❌ Invalid export type.');
    }
    
    if (exportParticipants.length === 0) {
      return m.reply(`❌ No ${type === 'admins' ? 'administrators' : 'contacts'} found to export.`);
    }
    
    await m.reply(`⏳ Creating VCF for ${exportParticipants.length} contacts...`);
    
    let vcfContent = '';
    exportParticipants.forEach(participant => {
      const phoneNumber = participant.id.split('@')[0];
      const name = participant.name || participant.notify || `User_${phoneNumber}`;
      const isAdmin = participant.admin ? ';ADMIN' : '';
      
      vcfContent += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}${isAdmin}\nTEL;TYPE=CELL:+${phoneNumber}\nEND:VCARD\n\n`;
    });
    
    const tempDir = path.join(__dirname, '..', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const filename = `contacts_${metadata.subject.replace(/[^a-z0-9]/gi, '_')}_${type}_${Date.now()}.vcf`;
    const filePath = path.join(tempDir, filename);
    
    await fs.writeFile(filePath, vcfContent, 'utf8');
    
    await sock.sendMessage(m.from, {
      document: { url: filePath },
      fileName: filename,
      mimetype: 'text/vcard',
      caption: `✅ *Contact Export Complete*\n\nGroup: ${metadata.subject}\nType: ${exportType}\nExported: ${exportParticipants.length} contacts\n\nPowered by CLOUD AI`
    }, { quoted: m });
    
    // Clean up temp file after 30 seconds
    setTimeout(() => {
      fs.unlink(filePath).catch(() => {});
    }, 30000);
    
  } catch (error) {
    console.error('VCF Export Error:', error);
    await m.reply('❌ Error creating VCF file.');
  }
}

module.exports.exportVCF = exportVCF;
