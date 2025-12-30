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
          { id: 'btn_vcf_all_pro', text: '📋 Export All Contacts' },
          { id: 'btn_vcf_admins_pro', text: '👑 Export Admins Only' },
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

// Export handler function
async function handleVCFExport(type, data, m, sock) {
  try {
    let exportParticipants = [];
    let exportType = '';
    
    switch(type) {
      case 'all':
        exportParticipants = data.participants;
        exportType = 'All Contacts';
        break;
      case 'admins':
        exportParticipants = data.admins;
        exportType = 'Administrators Only';
        break;
      default:
        return m.reply('❌ Invalid export type.');
    }
    
    if (exportParticipants.length === 0) {
      return m.reply(`❌ No ${type === 'admins' ? 'administrators' : 'contacts'} found to export.`);
    }
    
    // Show processing message
    const processingMsg = await m.reply(`⏳ *Processing Export Request*\n\n` +
      `📊 **Export Details:**\n` +
      `• Type: ${exportType}\n` +
      `• Contacts: ${exportParticipants.length}\n` +
      `• Format: VCF vCard 3.0\n` +
      `• Status: Generating...\n\n` +
      `_This may take a moment..._`);
    
    // Generate VCF content
    let vcfContent = `BEGIN:VCARD\nVERSION:3.0\nPRODID:-//CLOUD AI//BERA TECH//EN\n`;
    
    exportParticipants.forEach((participant, index) => {
      const phoneNumber = participant.id.split('@')[0];
      const name = participant.name || participant.notify || `Contact_${index + 1}`;
      const isAdmin = participant.admin ? ';ADMIN' : '';
      
      vcfContent += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nTEL;TYPE=CELL${isAdmin}:+${phoneNumber}\nNOTE:Exported from ${data.metadata.subject}\nEND:VCARD\n`;
    });
    
    vcfContent += `END:VCARD`;
    
    // Create temp directory
    const tempDir = path.join(__dirname, '..', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const groupName = data.metadata.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    const filename = `contacts_${groupName}_${timestamp}.vcf`;
    const filePath = path.join(tempDir, filename);
    
    // Write file
    await fs.writeFile(filePath, vcfContent, 'utf8');
    
    // Send file
    await sock.sendMessage(m.from, {
      document: { url: filePath },
      fileName: filename,
      mimetype: 'text/vcard',
      caption: `✅ *Contact Export Complete*\n\n` +
               `📁 **File:** ${filename}\n` +
               `📊 **Exported:** ${exportParticipants.length} contacts\n` +
               `👥 **Type:** ${exportType}\n` +
               `🏷️ **Group:** ${data.metadata.subject}\n` +
               `📅 **Date:** ${new Date().toLocaleDateString()}\n\n` +
               `*Powered by CLOUD AI Professional Suite*`
    }, { quoted: m });
    
    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      fs.unlink(filePath).catch(() => {});
    }, 300000);
    
  } catch (error) {
    console.error('❌ Export Process Error:', error);
    m.reply('❌ Failed to generate contact file. Please try again.');
  }
}
