import express from "express";
import fs from "fs-extra";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import { upload } from "./mega.js";
import path from "path";
import chalk from "chalk";

const router = express.Router();
const logger = pino({ level: "fatal" });
const SESSION_FOLDER = process.env.SESSION_FOLDER || "./mega_sessions";

fs.ensureDirSync(SESSION_FOLDER);

function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) {
            fs.removeSync(FilePath);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

// Store active sessions to prevent duplicate connections
const activeSessions = new Map();

router.get("/", async (req, res) => {
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).send({ code: "Phone number is required" });
    }

    num = num.replace(/[^0-9]/g, "");
    const phone = pn("+" + num);

    if (!phone.isValid()) {
        return res.status(400).send({ code: "Invalid phone number" });
    }

    num = phone.getNumber("e164").replace("+", "");
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const sessionPath = path.join(SESSION_FOLDER, `session_${num}_${sessionId}`);

    // Check if already processing this number
    if (activeSessions.has(num)) {
        return res.status(429).send({ code: "Session already processing for this number" });
    }

    activeSessions.set(num, true);
    await removeFile(sessionPath);
    fs.ensureDirSync(sessionPath);

    console.log(chalk.blue(`\n🔐 New pair request for: ${num}`));

    let responseSent = false;
    let timeoutId = null;

    async function initiateSession() {
        let EvoBot = null;
        
        try {
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();

            EvoBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: Browsers.ubuntu("Chrome"),
                markOnlineOnConnect: true,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
            });

            // Handle connection updates
            EvoBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    console.log(chalk.green(`✅ Connected successfully for ${num}`));
                    
                    try {
                        await delay(5000);
                        
                        const credsPath = path.join(sessionPath, "creds.json");
                        
                        if (fs.existsSync(credsPath)) {
                            // Upload to MEGA
                            console.log(chalk.blue(`📤 Uploading session to MEGA...`));
                            const megaUrl = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
                            const megaFileId = getMegaFileId(megaUrl);
                            
                            if (megaFileId) {
                                const sessionIdCode = `Evomd=@${megaFileId}`;
                                const userJid = jidNormalizedUser(`${num}@s.whatsapp.net`);
                                const time = new Date().toLocaleTimeString();
                                const date = new Date().toLocaleDateString();
                                
                                // Save session info
                                const sessionInfo = {
                                    phoneNumber: num,
                                    sessionId: sessionIdCode,
                                    megaFileId: megaFileId,
                                    timestamp: new Date().toISOString(),
                                    type: "pair_code",
                                    github: "Evo_MD_Beta"
                                };
                                
                                const infoPath = path.join(SESSION_FOLDER, `session_info_${num}_${Date.now()}.json`);
                                await fs.writeJson(infoPath, sessionInfo, { spaces: 2 });
                                
                                console.log(chalk.green(`📁 Session info saved`));

                                const successMessage = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*✅ EVO MD Whatsapp Bot*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 CONNECTION ESTABLISHED SUCCESSFULLY

📋 SESSION INFORMATION
──────────────────────────
🆔 ID : *${sessionIdCode}*
📞 PHONE : *+${num}*
🔐 TYPE : *Pair Code*
⏰ TIME : *${time}*
📅 DATE : *${date}*

📁 FILES GENERATED
──────────────────────────
✓ creds.json (Uploaded to MEGA)
✓ session_info_${num}.json (Local backup)

📍 STORAGE LOCATION
──────────────────────────
☁️ MEGA Cloud: /Evo MD Sessions/
📁 Local: ./mega_sessions/

⚠️ SECURITY NOTICE
──────────────────────────
🔴 NEVER share your session ID
🔴 NEVER share creds.json file
🟢 Keep backup in safe place
🟢 Use same ID for reconnection

⚡ FEATURES ENABLED
──────────────────────────
✓ Auto Backup to MEGA
✓ Local Session Storage
✓ Auto Git Sync

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *Made by Rithika* 👑
🔗 github.com/Evo_MD_Beta
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

                                // Send session ID as text
                                await EvoBot.sendMessage(userJid, { text: sessionIdCode });
                                console.log(chalk.green(`✅ Session ID sent to +${num}`));
                                
                                await delay(1000);
                                
                                // Send creds.json as document
                                await EvoBot.sendMessage(userJid, {
                                    document: fs.readFileSync(credsPath),
                                    mimetype: "application/json",
                                    fileName: "creds.json",
                                    caption: successMessage
                                });
                                
                                console.log(chalk.green(`✅ Creds.json sent to +${num}`));
                                console.log(chalk.green(`✅ Success message sent to +${num}`));
                            }
                        }

                        await delay(2000);
                        await removeFile(sessionPath);
                        await delay(1000);
                        activeSessions.delete(num);
                        process.exit(0);
                        
                    } catch (err) {
                        console.error(chalk.red("Error in connection open:"), err);
                        await removeFile(sessionPath);
                        activeSessions.delete(num);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401 && statusCode !== 403) {
                        console.log(chalk.yellow(`🔄 Reconnecting for ${num}...`));
                        initiateSession();
                    } else {
                        console.log(chalk.red(`❌ Session closed permanently for ${num}`));
                        activeSessions.delete(num);
                    }
                }
            });

            EvoBot.ev.on("creds.update", saveCreds);

            // Request pairing code
            if (!EvoBot.authState.creds.registered) {
                await delay(3000);
                let code = await EvoBot.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join("-") || code;

                if (!responseSent && !res.headersSent) {
                    responseSent = true;
                    console.log(chalk.green(`📲 Pairing code sent for ${num}: ${code}`));
                    res.send({ code });
                }
            }

            // Timeout handler
            timeoutId = setTimeout(async () => {
                if (!responseSent && !res.headersSent) {
                    responseSent = true;
                    res.status(408).send({ code: "Request timeout" });
                    await removeFile(sessionPath);
                    activeSessions.delete(num);
                    process.exit(1);
                }
            }, 90000);

        } catch (err) {
            console.error(chalk.red("Session error:"), err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: "Service unavailable" });
            }
            await removeFile(sessionPath);
            activeSessions.delete(num);
            process.exit(1);
        }
    }

    await initiateSession();
});

export default router;
