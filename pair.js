import express from 'express';
import fs from 'fs';
import pino from 'pino';
import simpleGit from 'simple-git';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// GitHub configuration
const GITHUB_USERNAME = 'K0reem0';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'TheMystic-Bot-MD';
const SESSION_FOLDER = 'MysticSession';
const BRANCH_NAME = 'master'; // أو 'master' حسب اسم فرعك الرئيسي

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

        const git = simpleGit();

        try {
            await git.status();
        } catch (error) {
            if (error.message.includes('not a git repository')) {
                await git.init();
                await git.addConfig('user.name', GITHUB_USERNAME);
                await git.addConfig('user.email', '202470349@su.edu.ye');
            } else {
                throw error;
            }
        }
        
        const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git`;
        const remotes = await git.getRemotes(true);
        if (!remotes.some(r => r.name === 'origin')) {
            await git.addRemote('origin', remoteUrl);
        }
        
        // Fetch and reset to remote state to avoid conflicts
        await git.fetch('origin', BRANCH_NAME);
        await git.reset(['--hard', `origin/${BRANCH_NAME}`]);
        
        // Create session directory if it doesn't exist
        if (!fs.existsSync(SESSION_FOLDER)) {
            fs.mkdirSync(SESSION_FOLDER);
        }
        
        // تحديد اسم الملف ليكون "MysticSession/creds.json"
        const fileName = `${SESSION_FOLDER}/creds.json`;
        
        // حذف ملف creds.json القديم إذا كان موجودًا
        if (fs.existsSync(fileName)) {
            removeFile(fileName);
        }

        // كتابة ملف creds.json الجديد
        fs.writeFileSync(fileName, sessionData);
        
        // استخدام `git.add` مع الخيار `true` لتجاهل .gitignore
        await git.add(fileName, true);
        
        await git.commit(`Added session for ${phoneNumber}`);
        await git.push('origin', BRANCH_NAME);

        return true;
    } catch (error) {
        console.error('GitHub push error:', error);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || 'session');

    await removeFile(dirs);

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

    num = phone.getNumber('e164').replace('+', '');

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
                    await delay(15000);

                    const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                    try {
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');
                        const pushSuccess = await pushToGitHub(sessionKnight, num);

                        if (pushSuccess) {
                            await KnightBot.sendMessage(userJid, {
                                image: { url: 'https://files.catbox.moe/yjj0x6.jpg' },
                                caption: `*❀ ───────⊰ ꪆৎ ⊱─────── ❀*\n\nشكرا لإستخدامك بوت هايسو 🤗\n\n*❀ ───────⊰ ꪆৎ ⊱─────── ❀*`
                            });

                            await KnightBot.sendMessage(userJid, {
                                text: `*❀ ───────⊰ ꪆৎ ⊱─────── ❀*\n\n⚠️ انتظر قليلا حتى يعمل البوت ⚠️\n\n*❀ ───────⊰ ꪆৎ ⊱─────── ❀*`
                            });

                            // --- التغييرات هنا ---
                            // 1. الانتظار لمدة دقيقة واحدة (60000 ميلي ثانية)
                            console.log("⏳ Waiting for 1 minute before cleanup and restart...");
                            await delay(60000);

                            // 2. حذف ملفات الجلسة المؤقتة
                            removeFile(dirs);
                            console.log("✅ Session files cleaned up.");

                            // 3. إعادة تشغيل العملية
                            console.log("🔄 Restarting session initiation...");
                            initiateSession();
                            // --- نهاية التغييرات ---
                        } else {
                            await KnightBot.sendMessage(userJid, {
                                text: `❌ فشل في حفظ بيانات الجلسة. يرجى المحاولة مرة أخرى.`
                            });

                            // في حالة الفشل، يتم حذف الملفات وإعادة التشغيل مباشرة
                            await delay(6000);
                            removeFile(dirs);
                            console.log("❌ Session cleanup after push failure.");
                        }
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
