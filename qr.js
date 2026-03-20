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
import QRCode from "qrcode";
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

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const sessionPath = path.join(SESSION_FOLDER, `qr_session_${sessionId}`);
    
    fs.ensureDirSync(sessionPath);
    let responseSent = false;

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
            });

            EvoBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !responseSent) {
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "H",
                            type: "image/png",
                            margin: 2,
                            width: 400,
                            color: { dark: "#00f3ff", light: "#000000" }
                        });

                        responseSent = true;
                        res.send({
                            qr: qrDataURL,
                            instructions: [
                                "1️⃣ Open WhatsApp on your phone",
                                "2️⃣ Tap Menu (⋮) or Settings",
                                "3️⃣ Select Linked Devices",
                                "4️⃣ Tap 'Link a Device'",
                                "5️⃣ Scan this QR code"
                            ]
                        });
                        
                    } catch (qrError) {
                        console.error(chalk.red("QR Error:"), qrError);
                    }
                }

                if (connection === "open") {
                    console.log(chalk.green(`✅ QR Connected: ${EvoBot.user?.id}`));
                    
                    try {
                        await delay(5000);
                        const credsPath = path.join(sessionPath, "creds.json");
                        
                        if (fs.existsSync(credsPath)) {
                            const megaUrl = await upload(credsPath, `creds_qr_${sessionId}.json`);
                            const megaFileId = getMegaFileId(megaUrl);
                            
                            if (megaFileId) {
                                const sessionIdCode = `Evomd=@${megaFileId}`;
                                const userJid = EvoBot.user?.id;
                                
                                if (userJid) {
                                    const phoneNumber = userJid.split(':')[0];
                                    const time = new Date().toLocaleTimeString();
                                    const date = new Date().toLocaleDateString();
                                    
                                    const sessionInfo = {
                                        phoneNumber: phoneNumber,
                                        sessionId: sessionIdCode,
                                        megaFileId: megaFileId,
                                        timestamp: new Date().toISOString(),
                                        type: "qr_code",
                                        github: "Evo_MD_Beta"
                                    };
                                    
                                    const infoPath = path.join(SESSION_FOLDER, `session_info_${phoneNumber}_${Date.now()}.json`);
                                    await fs.writeJson(infoPath, sessionInfo, { spaces: 2 });

                                    const successMessage = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*✅ EVO MD Whatsapp Bot*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 CONNECTION ESTABLISHED SUCCESSFULLY

📋 SESSION INFORMATION
──────────────────────────
🆔 ID : *${sessionIdCode}*
📞 PHONE : *+${phoneNumber}*
🔐 TYPE : *QR Code*
⏰ TIME : *${time}*
📅 DATE : *${date}*

📁 FILES GENERATED
──────────────────────────
✓ creds.json (Uploaded to MEGA)
✓ session_info_${phoneNumber}.json (Local backup)

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

                                    await EvoBot.sendMessage(userJid, { text: sessionIdCode });
                                    await delay(1000);
                                    
                                    await EvoBot.sendMessage(userJid, {
                                        document: fs.readFileSync(credsPath),
                                        mimetype: "application/json",
                                        fileName: "creds.json",
                                        caption: successMessage
                                    });
                                    
                                    console.log(chalk.green(`✅ QR Session sent to +${phoneNumber}`));
                                }
                            }
                        }

                        await delay(2000);
                        await removeFile(sessionPath);
                        await delay(1000);
                        process.exit(0);
                        
                    } catch (err) {
                        console.error(chalk.red("QR Connection error:"), err);
                        await removeFile(sessionPath);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401 && statusCode !== 403) {
                        console.log(chalk.yellow("🔄 Reconnecting QR..."));
                        initiateSession();
                    }
                }
            });

            EvoBot.ev.on("creds.update", saveCreds);

            setTimeout(async () => {
                if (!responseSent) {
                    res.status(408).send({ code: "QR generation timeout" });
                    await removeFile(sessionPath);
                    process.exit(1);
                }
            }, 60000);

        } catch (err) {
            console.error(chalk.red("QR Init error:"), err);
            if (!responseSent) {
                res.status(503).send({ code: "Service unavailable" });
            }
            await removeFile(sessionPath);
            process.exit(1);
        }
    }

    await initiateSession();
});

export default router;
