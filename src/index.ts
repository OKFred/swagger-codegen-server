import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import JSZip from "jszip";
import { Readable } from "stream";

// 获取当前文件路径
const __filename = fileURLToPath(import.meta.url);

const app = new Hono();

let requestProcessing = false;
// API 路由
app.post("/generate-code", async (c) => {
    if (requestProcessing) {
        return c.json({ error: "Another request is being processed" }, 400);
    }
    requestProcessing = true;
    const { swaggerUrl, swaggerJson, language, outputDir } = await c.req.json();

    if (!swaggerUrl && (!swaggerJson || !language)) {
        requestProcessing = false;
        return c.json({ error: "Missing required parameters" }, 400);
    }
    let input = swaggerUrl;
    let tempSwaggerPath: string;
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

    try {
        const result: fs.PathLike = await new Promise((resolve, reject) => {
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
                const outputDirPath = path.join("out", outputDir || language);

                const addFilesToZip = (dir: string, zipFolder: JSZip) => {
                    const files = fs.readdirSync(dir);
                    files.forEach((file) => {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            const folder = zipFolder.folder(file);
                            if (folder) addFilesToZip(filePath, folder);
                        } else {
                            const fileData = fs.readFileSync(filePath);
                            zipFolder.file(file, fileData);
                        }
                    });
                };
                addFilesToZip(outputDirPath, zip);

                const zipFilePath = "out.zip";
                const zipContent = await zip.generateAsync({ type: "nodebuffer" });
                fs.writeFileSync(zipFilePath, zipContent);
                return resolve(zipFilePath);
            });
        });
        c.header("Content-Type", "application/zip");
        c.header("Content-Disposition", `attachment; filename=code.zip`);
        const nodeStream = fs.createReadStream(result);
        const stream = Readable.toWeb(nodeStream) as ReadableStream;
        nodeStream.on("close", () => {
            fs.unlinkSync(result);
            console.log("zip file deleted");
        });
        requestProcessing = false;
        return c.body(stream);
    } catch (e) {
        requestProcessing = false;
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
});

// 启动服务器
serve({
    port: 8787,
    fetch: app.fetch,
});

console.log("Server started at http://localhost:8787");
