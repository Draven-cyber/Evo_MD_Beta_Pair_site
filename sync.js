import simpleGit from 'simple-git';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GitSync {
    constructor() {
        this.isSyncing = false;
        this.token = process.env.GITHUB_TOKEN;
        this.repo = "Evo_MD_Beta_Pair_site";
        this.owner = "Draven-cyber";
        this.repoUrl = `https://${this.token}@github.com/${this.owner}/${this.repo}.git`;
    }

    async initialize() {
        console.log(chalk.blue('🔄 Initializing GitHub Auto-Sync (Every minute)...'));
        
        if (!fs.existsSync(path.join(__dirname, '.git'))) {
            console.log(chalk.yellow('📦 Cloning repository...'));
            const git = simpleGit(__dirname);
            await git.clone(this.repoUrl, __dirname);
            console.log(chalk.green('✅ Repository cloned'));
        }

        const git = simpleGit(__dirname);
        await git.addRemote('origin', this.repoUrl);
        
        cron.schedule('* * * * *', () => this.sync());
        console.log(chalk.green('✅ Auto-sync scheduled: Every minute'));
        await this.sync();
    }

    async sync() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        
        try {
            console.log(chalk.blue(`\n🔄 Sync at ${new Date().toLocaleTimeString()}`));
            const git = simpleGit(__dirname);
            await git.fetch();
            const status = await git.status();
            
            if (status.behind > 0) {
                console.log(chalk.yellow(`📥 ${status.behind} updates found`));
                await git.pull('origin', 'main');
                console.log(chalk.green('✅ Updated'));
                await execPromise('npm install');
                setTimeout(() => process.exit(0), 2000);
            }
        } catch (error) {
            console.error(chalk.red('Sync error:'), error.message);
        } finally {
            this.isSyncing = false;
        }
    }
}

const sync = new GitSync();
sync.initialize();
export default sync;
