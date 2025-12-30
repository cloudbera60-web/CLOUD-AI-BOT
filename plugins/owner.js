const { sendButtons } = require('gifted-btns');

const ownerContact = async (m, gss) => {
    const prefix = process.env.BOT_PREFIX || '.';
    const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
    const text = m.body.slice(prefix.length + cmd.length).trim();

    if (cmd === 'owner') {
        try {
            // Send owner info with buttons
            await sendButtons(gss, m.from, {
                title: '👑 BERA TECH Contact',
                text: `*BERA TECH*\nDeveloper of CLOUD AI\n\n📞 Primary: 254116763755\n📞 Secondary: 254743982206\n✉️ Email: beratech00@gmail.com`,
                footer: 'Choose a contact option:',
                buttons: [
                    { id: 'btn_contact_call', text: '📞 Call Primary' },
                    { id: 'btn_contact_email', text: '✉️ Send Email' },
                    { id: 'btn_contact_support', text: '💬 Support' }
                ]
            });
            
            await m.React("✅");
        } catch (error) {
            console.error('Error sending owner contact:', error);
            // Fallback to traditional contact card
            const contactMsg = {
                contacts: {
                    displayName: 'BERA TECH',
                    contacts: [{
                        displayName: 'BERA TECH',
                        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:BERA TECH\nFN:BERA TECH\nitem1.TEL;waid=254116763755:254116763755\nitem2.TEL;waid=254743982206:254743982206\nitem3.EMAIL:beratech00@gmail.com\nitem1.X-ABLabel:Primary\nitem2.X-ABLabel:Secondary\nitem3.X-ABLabel:Email\nEND:VCARD`
                    }]
                }
            };
            
            await gss.sendMessage(m.from, contactMsg, { quoted: m });
        }
    }
};

module.exports = ownerContact;
