import * as mega from "megajs";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();

const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

export const upload = (filePath, fileName) => {
    return new Promise((resolve, reject) => {
        try {
            if (!fs.existsSync(filePath)) {
                reject(new Error("File not found"));
                return;
            }

            const storage = new mega.Storage(auth, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                const fileStream = fs.createReadStream(filePath);
                const uploadStream = storage.upload({
                    name: fileName,
                    size: fs.statSync(filePath).size
                });

                fileStream.pipe(uploadStream);

                uploadStream.on("complete", (file) => {
                    file.link((err, url) => {
                        storage.close();
                        if (err) {
                            reject(err);
                        } else {
                            resolve(url);
                        }
                    });
                });

                uploadStream.on("error", (error) => {
                    storage.close();
                    reject(error);
                });

                fileStream.on("error", reject);
            });

            storage.on("error", reject);
            
        } catch (err) {
            reject(err);
        }
    });
};

export const download = async (url) => {
    return new Promise((resolve, reject) => {
        try {
            const file = mega.File.fromURL(url);
            file.loadAttributes(async (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                const buffer = await file.downloadBuffer();
                resolve(buffer);
            });
        } catch (err) {
            reject(err);
        }
    });
};
