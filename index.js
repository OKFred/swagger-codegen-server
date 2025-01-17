import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import JSZip from "jszip";

// 获取当前文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = new Hono();

// API 路由
app.post("/generate-code", async (c) => {
    const { swaggerUrl, swaggerJson, language, outputDir } = await c.req.json();

    if (!swaggerUrl && (!swaggerJson || !language)) {
        return c.json({ error: "Missing required parameters" }, 400);
    }
    let input = swaggerUrl;
    let tempSwaggerPath;
    if (!swaggerUrl) {
        // 将 Swagger JSON 保存到临时文件
        tempSwaggerPath = path.join(os.tmpdir(), "swagger.json");
        fs.writeFileSync(tempSwaggerPath, swaggerJson);
        input = tempSwaggerPath;
    }
    // 输出目录

    // 构造 Docker 命令
    const dockerArgs = [
        "run",
        "--rm",
        "-v",
        `${process.cwd()}:/local`, // 当前工作目录挂载到 Docker 容器中的 `/local`
        "swaggerapi/swagger-codegen-cli",
        "generate",
        "-i",
        input,
        "-l",
        language,
        "-o",
        `/local/out/${outputDir || language}`, // 输出目录
    ];

    const result = new Promise((resolve, reject) => {
        // 执行命令
        const dockerProcess = spawn("docker", dockerArgs);

        // 捕获命令的标准输出
        dockerProcess.stdout.on("data", (data) => {
            console.log(`stdout: ${data}`);
        });

        // 捕获命令的错误输出
        dockerProcess.stderr.on("data", (data) => {
            console.error(`stderr: ${data}`);
        });

        // 捕获进程结束
        dockerProcess.on("close", async (code) => {
            // 删除临时文件
            if (tempSwaggerPath) fs.unlinkSync(tempSwaggerPath);

            if (code !== 0) {
                return reject({ error: `Code generation failed with exit code ${code}` });
            }

            // 使用 JSZip 将生成的代码打包
            const zip = new JSZip();
            const outputDirPath = path.join(__dirname, "out", outputDir || language);

            const addFilesToZip = (dir, zipFolder) => {
                const files = fs.readdirSync(dir);
                files.forEach((file) => {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        const folder = zipFolder.folder(file);
                        addFilesToZip(filePath, folder);
                    } else {
                        const fileData = fs.readFileSync(filePath);
                        zipFolder.file(file, fileData);
                    }
                });
            };

            addFilesToZip(outputDirPath, zip);

            const zipFilePath = path.join(__dirname, "out.zip");
            const zipContent = await zip.generateAsync({ type: "nodebuffer" });
            fs.writeFileSync(zipFilePath, zipContent);

            // 读取生成的 zip 文件并返回
            const fileStream = fs.createReadStream(zipFilePath);
            c.header("Content-Type", "application/zip");
            c.header("Content-Disposition", `attachment; filename=code.zip`);

            // 使用 stream 流式传输文件内容
            return resolve(fileStream);
        });
    });
    try {
        const res = await result;
        return c.body(
            new ReadableStream({
                start(controller) {
                    result.on("data", (chunk) => {
                        controller.enqueue(chunk);
                    });
                    result.on("end", () => {
                        controller.close();
                    });
                },
            }),
        );
    } catch (e) {
        return c.json(e, 400);
    }
});

// 启动服务器
serve({
    port: 8787,
    fetch: app.fetch,
});

console.log("Server started at http://localhost:8787");
