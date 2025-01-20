import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { commandMapping } from "./commandMapping.js";
import JSZip from "jszip";
import { Readable } from "stream";
const app = new Hono();
app.use(logger());
let requestProcessing = false;
// API 路由
app.post("/generate-code", async (c) => {
    if (requestProcessing) {
        return c.json({ error: "Another request is being processed" }, 400);
    }
    requestProcessing = true;
    const bodyObj = await c.req.json();
    const { swaggerUrl, swaggerJson, swaggerVersion, lang, output } = bodyObj;
    if (!swaggerUrl && (!swaggerJson || !lang)) {
        requestProcessing = false;
        return c.json({ error: "Missing required parameters" }, 400);
    }
    // 构造 Docker 命令
    const imageArr = [
        { tag: "v2", name: "swaggerapi/swagger-codegen-cli" },
        { tag: "v3", name: "swaggerapi/swagger-codegen-cli-v3" },
    ];
    const imageName = /3/.test(swaggerVersion) ? imageArr[1].name : imageArr[0].name;
    const mountDir = `${process.cwd()}:/local`; // 当前工作目录挂载到 Docker 容器中的 `/local`
    const dockerArgs = ["run", "--rm", "-v", mountDir, imageName];
    dockerArgs.push("generate");
    // 添加其他参数
    for (const { key, args } of commandMapping) {
        const value = bodyObj[key];
        if (value) {
            dockerArgs.push(args);
            if (value !== "true")
                dockerArgs.push(value);
        }
    }
    let input = swaggerUrl;
    let tempSwaggerPath;
    if (!swaggerUrl) {
        // 将 Swagger JSON 保存到临时文件
        tempSwaggerPath = "swagger.json";
        fs.writeFileSync(tempSwaggerPath, swaggerJson);
        input = "/local/swagger.json";
    }
    if (input) {
        dockerArgs.push("--input-spec");
        dockerArgs.push(input);
    }
    if (!output) {
        dockerArgs.push("--output");
        dockerArgs.push(`/local/out/${lang}`);
    }
    try {
        const result = await new Promise((resolve, reject) => {
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
                if (code !== 0) {
                    console.log("clean up...");
                    if (tempSwaggerPath)
                        fs.unlinkSync(tempSwaggerPath);
                    return reject(new Error(`Code generation failed with exit code ${code}`));
                }
                // 使用 JSZip 将生成的代码打包
                const zip = new JSZip();
                const outputDirPath = path.join("out", output || lang);
                const addFilesToZip = (dir, zipFolder) => {
                    const files = fs.readdirSync(dir);
                    files.forEach((file) => {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            const folder = zipFolder.folder(file);
                            if (folder)
                                addFilesToZip(filePath, folder);
                        }
                        else {
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
        const stream = Readable.toWeb(nodeStream);
        nodeStream.on("close", () => {
            console.log("clean up...");
            // 删除生成的 zip 文件
            fs.unlinkSync(result);
            // 删除临时文件
            if (tempSwaggerPath)
                fs.unlinkSync(tempSwaggerPath);
            //同时清理out文件夹
            fs.rmdirSync(path.join("out", output || lang), { recursive: true });
            console.log("success!");
        });
        requestProcessing = false;
        return c.body(stream);
    }
    catch (e) {
        requestProcessing = false;
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
});
// app.get("/public/*", serveStatic({ root: "./public" }));
app.get("/", (c) => c.json({ ok: true, message: new Date().toLocaleString() }));
app.notFound((c) => c.json({ error: "Not found" }, 404));
// 启动服务器
serve({
    port: 8787,
    fetch: app.fetch,
});
console.log("Server started at http://localhost:8787");
