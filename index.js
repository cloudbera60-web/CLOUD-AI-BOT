// Load environment variables first
require('dotenv').config();

const express = require('express');
const path = require('path');
const app = express();
const bodyParser = require("body-parser");
const cors = require('cors');
const { PayHeroClient } = require('payhero-devkit');

// Get port from environment
const PORT = process.env.PORT || 50900;

const { 
  qrRoute,
  pairRoute
} = require('./routes');

require('events').EventEmitter.defaultMaxListeners = 2000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize PayHero Client
const payheroClient = new PayHeroClient({
  authToken: process.env.PAYHERO_AUTH_TOKEN || process.env.AUTH_TOKEN
});

// Routes
app.use('/qr', qrRoute);
app.use('/code', pairRoute);

// ==================== PAYMENT ROUTES ====================

// STK Push Endpoint - REAL IMPLEMENTATION
app.post('/api/stk-push', async (req, res) => {
  try {
    const { phone_number, amount, external_reference, customer_name } = req.body;

    // Validation
    if (!phone_number || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and amount are required'
      });
    }

    // Format phone number
    let formattedPhone = phone_number.trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }

    if (!formattedPhone.startsWith('254')) {
      return res.status(400).json({
        success: false,
        error: 'Phone number must be in format 2547XXXXXXXX'
      });
    }

    // REAL STK Push with your credentials
    const stkPayload = {
      phone_number: formattedPhone,
      amount: parseFloat(amount),
      provider: process.env.DEFAULT_PROVIDER || 'm-pesa',
      channel_id: process.env.CHANNEL_ID || '3342',
      external_reference: external_reference || `BOT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      customer_name: customer_name || 'CLOUD AI Customer'
    };

    console.log('💳 [BOT] Initiating STK Push:', stkPayload);
    
    const response = await payheroClient.stkPush(stkPayload);
    
    console.log('✅ [BOT] STK Push Response:', response);
    
    res.json({
      success: true,
      message: 'STK push initiated successfully',
      data: response
    });

  } catch (error) {
    console.error('❌ [BOT] STK Push Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate STK push'
    });
  }
});

// Transaction Status Endpoint - REAL IMPLEMENTATION
app.get('/api/transaction-status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    
    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reference is required'
      });
    }

    console.log('💳 [BOT] Checking transaction status:', reference);
    const response = await payheroClient.transactionStatus(reference);
    console.log('✅ [BOT] Status Response:', response);
    
    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('❌ [BOT] Transaction Status Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get transaction status'
    });
  }
});

// Payment Health Check
app.get('/api/payment/health', async (req, res) => {
  try {
    // Test the connection by checking service wallet balance
    const balance = await payheroClient.serviceWalletBalance();
    
    res.json({
      success: true,
      message: 'Payment system is connected',
      account_id: process.env.CHANNEL_ID || '3342',
      provider: process.env.DEFAULT_PROVIDER || 'm-pesa',
      timestamp: new Date().toISOString(),
      balance: balance
    });
  } catch (error) {
    res.json({
      success: false,
      message: 'Payment system connection failed',
      error: error.message
    });
  }
});

// Payment webhook for automatic confirmation
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const paymentData = req.body;
    
    console.log('💰 [BOT] Payment Webhook Received:', JSON.stringify(paymentData, null, 2));
    
    // Here you can:
    // 1. Send WhatsApp notification to owner
    // 2. Update database
    // 3. Send confirmation to customer
    
    // Send response to acknowledge receipt
    res.json({ success: true, message: 'Webhook received' });
    
  } catch (error) {
    console.error('❌ [BOT] Webhook Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== BOT ROUTES ====================

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
    const pluginLoader = require('./plugin-loader');
    const database = require('./database');
    const { getActiveBots } = require('./bot-runner');
    
    // Check payment system health
    let paymentHealth = { status: 'Not configured' };
    try {
        const balance = await payheroClient.serviceWalletBalance();
        paymentHealth = {
            status: 'Connected ✅',
            account_id: process.env.CHANNEL_ID || '3342',
            balance: balance,
            provider: process.env.DEFAULT_PROVIDER || 'm-pesa'
        };
    } catch (error) {
        paymentHealth = {
            status: 'Disconnected ❌',
            error: error.message
        };
    }
    
    res.json({
        status: 200,
        success: true,
        service: 'CLOUD AI Bot Runner',
        environment: process.env.NODE_ENV || 'production',
        timestamp: new Date().toISOString(),
        server: {
            port: PORT,
            uptime: process.uptime(),
            memory: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
        },
        bot: {
            activeBots: Object.keys(getActiveBots()).length,
            pluginsLoaded: pluginLoader.plugins ? pluginLoader.plugins.size : 0,
            name: process.env.BOT_NAME || 'CLOUD AI',
            mode: process.env.BOT_MODE || 'public',
            prefix: process.env.BOT_PREFIX || '.'
        },
        database: {
            mongoConnected: database.isConnected ? '✅ Connected' : '❌ Disconnected'
        },
        payment: paymentHealth,
        owner: {
            name: 'BERA TECH',
            phone: process.env.OWNER_NUMBER || '254116763755',
            email: process.env.OWNER_EMAIL || 'beratech00@gmail.com'
        }
    });
});

// API Documentation
app.get('/api/docs', (req, res) => {
    res.json({
        endpoints: {
            payment: {
                'POST /api/stk-push': 'Initiate STK push payment',
                'GET /api/transaction-status/:reference': 'Check payment status',
                'GET /api/payment/health': 'Payment system health check',
                'POST /api/payment/webhook': 'Payment confirmation webhook'
            },
            bot: {
                'GET /health': 'Bot system health check',
                'GET /': 'Home page',
                'GET /pair': 'Pairing interface'
            }
        }
    });
});

// Initialize bot system
async function startServer() {
    try {
        console.log('🚀 Starting CLOUD AI Bot Runner...');
        console.log('💳 Payment System: INTEGRATED');
        console.log('🔐 Account ID:', process.env.CHANNEL_ID || '3342');
        
        // Load configuration
        const configManager = require('./config-manager');
        await configManager.loadConfig();
        
        // Connect to MongoDB
        const database = require('./database');
        const dbConnected = await database.connect();
        
        if (dbConnected) {
            console.log('✅ MongoDB connected successfully');
        } else {
            console.log('⚠️ Running without database persistence');
        }
        
        // Load plugins
        const pluginLoader = require('./plugin-loader');
        const pluginCount = await pluginLoader.loadPlugins();
        console.log(`✅ ${pluginCount} plugin(s) loaded`);
        
        // Initialize bot system
        const { initializeBotSystem } = require('./bot-runner');
        const systemReady = await initializeBotSystem();
        
        if (systemReady) {
            app.listen(PORT, () => {
                console.log(`
╔══════════════════════════════════════════════════════════╗
║                CLOUD AI BOT RUNNER                       ║
╠══════════════════════════════════════════════════════════╣
║  📍 Port: ${PORT}                                            ║
║  🤖 Bot Name: ${process.env.BOT_NAME || 'CLOUD AI'}             ║
║  👑 Owner: ${process.env.OWNER_NAME || 'BERA TECH'}           ║
║  🔧 Prefix: ${process.env.BOT_PREFIX || '.'}                  ║
║  💳 Account: ${process.env.CHANNEL_ID || '3342'}              ║
║  🗄️  MongoDB: ${database.isConnected ? '✅ Connected' : '❌ Disconnected'}
║  📦 Plugins: ${pluginCount} loaded                         ║
║  🔗 URL: http://localhost:${PORT}                         ║
╚══════════════════════════════════════════════════════════╝
                `);
                console.log('✅ Server is ready!');
                console.log(`• Home: http://localhost:${PORT}`);
                console.log(`• Pair: http://localhost:${PORT}/pair`);
                console.log(`• Health: http://localhost:${PORT}/health`);
                console.log(`• API Docs: http://localhost:${PORT}/api/docs`);
                console.log('💳 Payment System Ready');
                console.log('📱 Owner Commands: .stk, .tx, .balance');
            });
        } else {
            console.error('❌ Failed to initialize bot system');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    const database = require('./database');
    await database.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n👋 Received termination signal...');
    const database = require('./database');
    await database.close();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
