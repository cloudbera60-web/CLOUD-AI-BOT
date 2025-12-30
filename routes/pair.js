const { 
    giftedId,
    removeFile,
    generateRandomCode
} = require('../gift');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const { startBotInstance } = require('../bot-runner');
const {
    default: giftedConnect,
    useMultiFileAuthState,
    delay,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "../session");

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;
    let responseSent = false;
    let botInstance = null;
    let pairingSocket = null; // Store the socket for reconnection

    // Create session directory if it doesn't exist
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    async function GIFTED_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        
        try {
            pairingSocket = giftedConnect({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                getMessage: async () => undefined,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000, 
                keepAliveIntervalMs: 30000
            });

            if (!pairingSocket.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                
                const randomCode = generateRandomCode();
                const code = await pairingSocket.requestPairingCode(num, randomCode);
                
                if (!responseSent && !res.headersSent) {
                    res.json({ 
                        code: code,
                        message: "Enter this code in WhatsApp Linked Devices",
                        sessionId: id
                    });
                    responseSent = true;
                }
            }

            pairingSocket.ev.on('creds.update', saveCreds);
            
            pairingSocket.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    console.log(`✅ Pairing successful for session: ${id}`);
                    
                    // Start the bot with the authenticated state
                    try {
                        botInstance = await startBotInstance(id, state);
                        
                        // Send success notification
                        await pairingSocket.sendMessage(pairingSocket.user.id, {
                            text: `✅ *GIFTED-MD Bot Activated!*\n\nYour bot is now running with full functionality!\n\nUse commands like .menu to get started.\n\nBot ID: ${id}`
                        });
                        
                        // Wait a moment then close the pairing socket (not the bot!)
                        await delay(3000);
                        await pairingSocket.ws.close();
                        
                        // Clean up session directory (optional)
                        await removeFile(path.join(sessionDir, id));
                        
                    } catch (botError) {
                        console.error(`❌ Failed to start bot for ${id}:`, botError);
                        
                        await pairingSocket.sendMessage(pairingSocket.user.id, {
                            text: `❌ *Bot Startup Failed*\n\nFailed to initialize bot features.\n\nError: ${botError.message}`
                        });
                        
                        await pairingSocket.ws.close();
                        await removeFile(path.join(sessionDir, id));
                    }
                    
                } else if (connection === "close") {
                    if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                        console.log("Pairing connection closed, attempting to reconnect...");
                        await delay(5000);
                        GIFTED_PAIR_CODE(); // RECONNECTION LOGIC
                    } else {
                        console.log("Pairing connection closed normally");
                        await removeFile(path.join(sessionDir, id));
                    }
                }
            });

        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ 
                    code: "SERVICE_UNAVAILABLE",
                    message: "Service is Currently Unavailable" 
                });
                responseSent = true;
            }
            await removeFile(path.join(sessionDir, id));
        }
    }

    try {
        await GIFTED_PAIR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await removeFile(path.join(sessionDir, id));
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ 
                code: "SERVICE_ERROR",
                message: "Service Error" 
            });
        }
    }
});

module.exports = router;
