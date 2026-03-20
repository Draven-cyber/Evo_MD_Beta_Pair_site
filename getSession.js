import express from "express";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";

const router = express.Router();
const SESSION_FOLDER = process.env.SESSION_FOLDER || "./mega_sessions";

fs.ensureDirSync(SESSION_FOLDER);

router.get("/list", async (req, res) => {
    try {
        const files = await fs.readdir(SESSION_FOLDER);
        const sessionFiles = files.filter(f => f.startsWith("session_info_") && f.endsWith(".json"));
        
        const sessions = await Promise.all(
            sessionFiles.map(async (file) => {
                const content = await fs.readJson(path.join(SESSION_FOLDER, file));
                return content;
            })
        );
        
        sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json({ count: sessions.length, sessions });
    } catch (error) {
        res.status(500).json({ error: "Failed to list sessions" });
    }
});

router.get("/phone/:phone", async (req, res) => {
    const phone = req.params.phone;
    try {
        const files = await fs.readdir(SESSION_FOLDER);
        const sessionFile = files.find(f => f.includes(`_info_${phone}_`) && f.endsWith(".json"));
        
        if (!sessionFile) {
            return res.status(404).json({ error: "Session not found" });
        }
        
        const sessionInfo = await fs.readJson(path.join(SESSION_FOLDER, sessionFile));
        res.json(sessionInfo);
    } catch (error) {
        res.status(500).json({ error: "Failed to retrieve session" });
    }
});

router.delete("/phone/:phone", async (req, res) => {
    const phone = req.params.phone;
    try {
        const files = await fs.readdir(SESSION_FOLDER);
        const sessionFiles = files.filter(f => f.includes(`_info_${phone}_`) && f.endsWith(".json"));
        
        for (const file of sessionFiles) {
            await fs.remove(path.join(SESSION_FOLDER, file));
        }
        
        res.json({ message: `Deleted ${sessionFiles.length} session(s) for ${phone}` });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete session" });
    }
});

export default router;
