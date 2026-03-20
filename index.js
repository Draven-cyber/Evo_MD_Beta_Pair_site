import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs-extra";
import compression from "compression";
import cors from "cors";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";
import sessionRouter from "./getSession.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Create sessions folder
const SESSION_FOLDER = process.env.SESSION_FOLDER || "./mega_sessions";
fs.ensureDirSync(SESSION_FOLDER);

// Create logs folder
const LOGS_FOLDER = "./logs";
fs.ensureDirSync(LOGS_FOLDER);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));

// Compression
app.use(compression());

// CORS
app.use(cors({
    origin: '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/pair', limiter);
app.use('/qr', limiter);

// Logging
app.use(morgan('combined'));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// Increase event listeners
import("events").then((events) => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "pair.html"));
});

app.use("/pair", pairRouter);
app.use("/qr", qrRouter);
app.use("/sessions", sessionRouter);

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        sessions: fs.readdirSync(SESSION_FOLDER).filter(f => f.includes('session_info')).length,
        github: "Evo_MD_Beta"
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(chalk.red('Server error:'), err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(chalk.green(`
    ╔══════════════════════════════════════╗
    ║     🚀 EVO MD SERVER STARTED         ║
    ╠══════════════════════════════════════╣
    ║  📍 URL: http://localhost:${PORT}        ║
    ║  📁 Sessions: ./mega_sessions        ║
    ║  🐙 GitHub: Evo_MD_Beta              ║
    ║  👑 Creator: Rithika                 ║
    ╚══════════════════════════════════════╝
    `));
});

// Start GitHub sync
import('./sync.js');

export default app;
