const axios = require('axios');
const { sendButtons } = require('gifted-btns');

// Owner verification function
function isOwner(userId) {
  const ownerNumbers = process.env.OWNER_NUMBERS ? 
    process.env.OWNER_NUMBERS.split(',') : 
    ['254116763755', '254743982206'];
  return ownerNumbers.includes(userId);
}

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  const userId = m.sender.split('@')[0];
  
  // ==================== PUBLIC PAYMENT COMMANDS ====================
  if (cmd === 'pay' && !isOwner(userId)) {
    await showPublicPaymentMenu(m, sock);
    return;
  }
  
  if (cmd === 'balance' && !isOwner(userId)) {
    await m.reply(`💳 *Payment Balance*\n\nFor balance inquiries, contact owner:\n📞 ${process.env.OWNER_NUMBER || '254116763755'}\n✉️ ${process.env.OWNER_EMAIL || 'beratech00@gmail.com'}`);
    return;
  }
  
  // ==================== OWNER-ONLY PAYMENT COMMANDS ====================
  if (!isOwner(userId)) {
    return; // Silent exit for non-owners
  }
  
  if (cmd === 'stk' || cmd === 'request') {
    await handleStkPush(m, sock);
    return;
  }
  
  if (cmd === 'tx' || cmd === 'transaction') {
    await handleTransactionCheck(m, sock);
    return;
  }
  
  if (cmd === 'pay' && isOwner(userId)) {
    await showOwnerPaymentPanel(m, sock);
    return;
  }
  
  if (cmd === 'balance' && isOwner(userId)) {
    await handleBalanceCheck(m, sock);
    return;
  }
  
  if (cmd === 'payments' || cmd === 'payment') {
    await showPaymentDashboard(m, sock);
    return;
  }
  
  if (cmd === 'paymenthelp' || cmd === 'payhelp') {
    await showPaymentHelp(m, sock);
    return;
  }
};

// ==================== PUBLIC PAYMENT FUNCTIONS ====================
async function showPublicPaymentMenu(m, sock) {
  await sendButtons(sock, m.from, {
    title: '💳 Payment Services',
    text: `*CLOUD AI Payment Center*\n\n` +
          `💰 Make payments for:\n` +
          `• VIP Bot Access\n` +
          `• Premium Features\n` +
          `• Custom Services\n` +
          `• Donations\n\n` +
          `📞 Contact Owner for payment instructions:`,
    footer: 'BERA TECH | Secure M-Pesa Payments',
    buttons: [
      { id: 'btn_contact_owner', text: '📞 Contact Owner' },
      { id: 'btn_payment_info', text: '💰 Payment Info' },
      { id: 'btn_menu_back', text: '🔙 Back' }
    ]
  });
}

async function showPaymentInfo(m, sock) {
  await m.reply(`💳 *Payment Information*\n\n` +
               `**Accepted Payments:**\n` +
               `✅ M-Pesa\n` +
               `✅ Airtel Money\n\n` +
               `**Payment Process:**\n` +
                `1. Contact owner with amount\n` +
                `2. Receive payment request\n` +
                `3. Complete payment\n` +
                `4. Get instant access\n\n` +
               `**Contact:**\n` +
               `📞 ${process.env.OWNER_NUMBER || '254116763755'}\n` +
               `✉️ ${process.env.OWNER_EMAIL || 'beratech00@gmail.com'}`);
}

// ==================== OWNER PAYMENT FUNCTIONS ====================
async function showOwnerPaymentPanel(m, sock) {
  await sendButtons(sock, m.from, {
    title: '💳 OWNER - Payment Control',
    text: `*Admin Payment Dashboard*\n\n` +
          `👑 **Owner:** ${m.sender.split('@')[0]}\n` +
          `💼 **Account:** ${process.env.CHANNEL_ID || '3342'}\n` +
          `📊 **Status:** Active\n\n` +
          `*Quick Actions:*`,
    footer: 'CLOUD AI Payment System | Admin Only',
    buttons: [
      { id: 'btn_stk_100', text: '💰 Send KES 100' },
      { id: 'btn_stk_500', text: '💰 Send KES 500' },
      { id: 'btn_stk_1000', text: '💰 Send KES 1000' },
      { id: 'btn_stk_custom', text: '⚡ Custom Amount' },
      { id: 'btn_check_tx', text: '📊 Check TX' },
      { id: 'btn_payment_dashboard', text: '🎛️ Dashboard' }
    ]
  });
}

async function handleStkPush(m, sock) {
  const args = m.body.slice(prefix.length + 3).trim().split(' ');
  const phone = args[0];
  const amount = args[1];
  
  if (!phone || !amount) {
    await sendButtons(sock, m.from, {
      title: '💳 STK Push Setup',
      text: `*Send STK Push to Customer*\n\nUsage: .stk [phone] [amount]\nExample: .stk 254712345678 100\n\nPhone formats:\n• 254712345678\n• 0712345678`,
      footer: 'Owner Command Only',
      buttons: [
        { id: 'btn_stk_100', text: 'Quick: KES 100' },
        { id: 'btn_stk_500', text: 'Quick: KES 500' },
        { id: 'btn_stk_1000', text: 'Quick: KES 1000' },
        { id: 'btn_stk_custom_input', text: '📝 Enter Custom' }
      ]
    });
    return;
  }
  
  await processStkPush(m, sock, phone, amount);
}

async function processStkPush(m, sock, phone, amount, customRef = null) {
  try {
    // Format phone
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }
    
    if (!formattedPhone.startsWith('254')) {
      return m.reply(`❌ Invalid phone format\n\nUse: 2547XXXXXXXX or 07XXXXXXXX`);
    }
    
    const reference = customRef || `BOT-${m.sender.split('@')[0].slice(-4)}-${Date.now().toString().slice(-6)}`;
    
    await m.reply(`💳 *Initiating STK Push*\n\n` +
                 `📱 To: ${formattedPhone}\n` +
                 `💰 Amount: KES ${amount}\n` +
                 `🔖 Reference: ${reference}\n\n` +
                 `_Sending request to M-Pesa..._`);
    
    await m.React('⏳');
    
    // Call YOUR OWN SERVER
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 50900}`;
    
    const response = await axios.post(`${serverUrl}/api/stk-push`, {
      phone_number: formattedPhone,
      amount: parseFloat(amount),
      external_reference: reference,
      customer_name: 'CLOUD AI Customer'
    }, {
      timeout: 30000
    });
    
    if (response.data.success) {
      const data = response.data.data;
      
      await m.reply(`✅ *STK Push Sent!*\n\n` +
                   `📱 Customer: ${formattedPhone}\n` +
                   `💰 Amount: KES ${amount}\n` +
                   `🔖 Reference: ${data.reference}\n` +
                   `📊 Status: Pending\n\n` +
                   `_Customer should receive M-Pesa prompt shortly._\n\n` +
                   `Check status: .tx ${data.reference}`);
      
      await m.React('✅');
      
      // Store for quick status check
      m.lastStkPush = {
        reference: data.reference,
        phone: formattedPhone,
        amount: amount,
        time: new Date().toISOString()
      };
      
    } else {
      throw new Error(response.data.error || 'STK push failed');
    }
    
  } catch (error) {
    console.error('STK Error:', error);
    
    let errorMsg = 'Failed to send STK push. ';
    if (error.response?.data?.error) {
      errorMsg += error.response.data.error;
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg += 'Payment service unavailable.';
    } else if (error.code === 'ECONNABORTED') {
      errorMsg += 'Request timeout. Check server.';
    } else {
      errorMsg += error.message;
    }
    
    await m.reply(`❌ *STK Push Failed*\n\n${errorMsg}\n\nCheck: ${process.env.SERVER_URL}/health`);
    await m.React('❌');
  }
}

async function handleTransactionCheck(m, sock) {
  const args = m.body.slice(prefix.length + 2).trim().split(' ');
  const reference = args[0] || (m.lastStkPush?.reference);
  
  if (!reference) {
    await m.reply(`📊 *Check Transaction*\n\nUsage: .tx [reference]\n\nOr use .stk first to get a reference.`);
    return;
  }
  
  await checkTransactionStatus(m, sock, reference);
}

async function checkTransactionStatus(m, sock, reference) {
  try {
    await m.reply(`📊 *Checking Transaction*\n\nReference: ${reference}\n\n_Querying M-Pesa..._`);
    
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 50900}`;
    const response = await axios.get(`${serverUrl}/api/transaction-status/${reference}`, {
      timeout: 15000
    });
    
    if (response.data.success) {
      const tx = response.data.data;
      
      let statusEmoji = '⏳';
      let statusText = tx.status || 'Unknown';
      
      if (statusText.includes('success') || statusText.includes('complete')) {
        statusEmoji = '✅';
      } else if (statusText.includes('fail') || statusText.includes('cancel')) {
        statusEmoji = '❌';
      } else if (statusText.includes('pending')) {
        statusEmoji = '🔄';
      }
      
      await m.reply(`${statusEmoji} *Transaction Status*\n\n` +
                   `🔖 Reference: ${tx.reference}\n` +
                   `📱 Phone: ${tx.phone_number || 'N/A'}\n` +
                   `💰 Amount: KES ${tx.amount || 'N/A'}\n` +
                   `📊 Status: ${statusText.toUpperCase()}\n` +
                   `💾 Code: ${tx.response_code || 'N/A'}\n` +
                   `📝 Description: ${tx.response_description || 'N/A'}\n` +
                   `📅 Time: ${tx.timestamp || new Date().toLocaleString()}`);
      
    } else {
      throw new Error(response.data.error || 'Status check failed');
    }
    
  } catch (error) {
    console.error('Status Check Error:', error);
    await m.reply(`❌ *Status Check Failed*\n\n${error.message}`);
  }
}

async function handleBalanceCheck(m, sock) {
  try {
    await m.reply(`💰 *Checking Account Balance*\n\n_Connecting to PayHero..._`);
    
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 50900}`;
    const response = await axios.get(`${serverUrl}/api/payment/health`, {
      timeout: 10000
    });
    
    if (response.data.success) {
      const { account_id, balance, provider } = response.data;
      
      await m.reply(`💰 *Account Overview*\n\n` +
                   `👑 Account ID: ${account_id}\n` +
                   `💼 Balance: KES ${balance?.balance || '0.00'}\n` +
                   `📊 Currency: ${balance?.currency || 'KES'}\n` +
                   `🏦 Provider: ${provider}\n` +
                   `🔄 Last Check: ${new Date().toLocaleTimeString()}\n\n` +
                   `_Payment system is active and ready._`);
    } else {
      await m.reply(`⚠️ *Payment System Status*\n\n${response.data.message}\n\nCheck: ${serverUrl}/health`);
    }
    
  } catch (error) {
    console.error('Balance Check Error:', error);
    await m.reply(`❌ *Balance Check Failed*\n\n${error.message}\n\nCheck server status.`);
  }
}

async function showPaymentDashboard(m, sock) {
  try {
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 50900}`;
    const healthRes = await axios.get(`${serverUrl}/api/payment/health`, {
      timeout: 10000
    });
    
    let paymentStatus = '❌ Disconnected';
    let balance = 'N/A';
    let accountId = process.env.CHANNEL_ID || '3342';
    
    if (healthRes.data.success) {
      paymentStatus = '✅ Connected';
      balance = `KES ${healthRes.data.balance?.balance || '0.00'}`;
      accountId = healthRes.data.account_id || accountId;
    }
    
    await sendButtons(sock, m.from, {
      title: '🎛️ Payment Dashboard',
      text: `*Payment System Status*\n\n` +
            `🔌 Connection: ${paymentStatus}\n` +
            `💰 Balance: ${balance}\n` +
            `🏦 Account: ${accountId}\n` +
            `📊 Provider: ${process.env.DEFAULT_PROVIDER || 'm-pesa'}\n\n` +
            `*Quick Actions:*`,
      footer: 'CLOUD AI Payment Management',
      buttons: [
        { id: 'btn_stk_100', text: '💸 KES 100' },
        { id: 'btn_stk_500', text: '💸 KES 500' },
        { id: 'btn_stk_1000', text: '💸 KES 1000' },
        { id: 'btn_check_tx', text: '📊 Check TX' },
        { id: 'btn_payment_health', text: '❤️ Health' },
        { id: 'btn_menu_back', text: '🔙 Back' }
      ]
    });
    
  } catch (error) {
    await m.reply(`❌ *Dashboard Error*\n\n${error.message}\n\nServer may be offline.`);
  }
}

async function showPaymentHelp(m, sock) {
  const helpText = `💳 *PAYMENT SYSTEM HELP - OWNER*\n\n` +
                  `🔧 **Commands:**\n` +
                  `• .stk [phone] [amount] - Send STK push\n` +
                  `• .tx [reference] - Check transaction\n` +
                  `• .balance - Check account balance\n` +
                  `• .payments - Payment dashboard\n` +
                  `• .pay - Show payment menu\n\n` +
                  `📱 **Phone Formats:**\n` +
                  `• 254712345678 (Recommended)\n` +
                  `• 0712345678 (Auto-converts to 254)\n\n` +
                  `💰 **Quick Amounts:**\n` +
                  `• .stk 254712345678 100\n` +
                  `• .stk 0712345678 500\n\n` +
                  `📊 **Checking Payments:**\n` +
                  `• .tx BOT-XXXX-XXXXXX\n` +
                  `• Last transaction auto-saved\n\n` +
                  `🔐 **Account:** ${process.env.CHANNEL_ID || '3342'}\n` +
                  `🏦 **Provider:** ${process.env.DEFAULT_PROVIDER || 'm-pesa'}`;
  
  await m.reply(helpText);
}

// Export for bot-runner.js button handling
module.exports.handleStkPush = processStkPush;
module.exports.checkTransactionStatus = checkTransactionStatus;
module.exports.isOwner = isOwner;
module.exports.showPaymentDashboard = showPaymentDashboard;
