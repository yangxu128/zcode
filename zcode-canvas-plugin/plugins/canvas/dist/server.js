// 画布 MCP server：只暴露文档读写与意图写入，生成执行由宿主进程的 worker 负责。
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { applyOperations, cancelGeneration, listBoards, readBoard, requestGeneration, resolveWorkspace, } from "./document.js";
const PLUGIN_NAME = "canvas";
const PLUGIN_VERSION = "0.1.0";
const workspaceSchema = z.string().min(1).optional();
const nodeSchema = z.record(z.string(), z.unknown());
const operationsSchema = z
    .array(z.union([
    z.object({ op: z.literal("upsert_node"), node: nodeSchema }),
    z.object({ op: z.literal("remove_node"), id: z.string().min(1) }),
    z.object({ op: z.literal("set_edges"), edges: z.array(nodeSchema) }),
]))
    .min(1);
const requestSchema = z.object({
    prompt: z.string().min(1),
    size: z.string().min(1).optional(),
    ratio: z.string().min(1).optional(),
    seconds: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    firstFrame: z.string().min(1).optional(),
});
const TOOLS = [
    {
        name: "canvas_list_boards",
        description: "列出当前工作区里的画布文档（.zcode/canvas/*.json）。",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "canvas_read",
        description: "读取画布文档（节点、连线与生成态）；board 缺省取 default-*。",
        inputSchema: {
            type: "object",
            properties: {
                board: { type: "string", description: "画布文件名，例如 default-1tp8aj5.json" },
                workspace: { type: "string", description: "工作区绝对路径；缺省用当前工作区" },
            },
        },
    },
    {
        name: "canvas_apply",
        description: "批量修改画布：upsert_node / remove_node / set_edges。只改文档，不触发生成。",
        inputSchema: {
            type: "object",
            properties: {
                board: { type: "string" },
                workspace: { type: "string" },
                operations: {
                    type: "array",
                    items: { type: "object" },
                    description: "操作列表：{op:'upsert_node',node} | {op:'remove_node',id} | {op:'set_edges',edges}",
                },
            },
            required: ["operations"],
        },
    },
    {
        name: "canvas_request_generation",
        description: "给已有节点排一条图片/视频生成意图，立即返回 requestId；宿主 worker 会异步执行并把结果写回文档。不要在同一轮等待出片。",
        inputSchema: {
            type: "object",
            properties: {
                board: { type: "string" },
                workspace: { type: "string" },
                nodeId: { type: "string" },
                prompt: { type: "string" },
                size: { type: "string" },
                ratio: { type: "string" },
                seconds: { type: "string", description: "视频时长，4–12 的整数字符串" },
                model: { type: "string", description: "可选：providerId/modelId 或裸 modelId" },
                firstFrame: { type: "string", description: "首帧：工作区相对路径或 data URI" },
            },
            required: ["nodeId", "prompt"],
        },
    },
    {
        name: "canvas_cancel_generation",
        description: "取消节点上尚未被 worker 认领的生成意图。",
        inputSchema: {
            type: "object",
            properties: {
                board: { type: "string" },
                workspace: { type: "string" },
                nodeId: { type: "string" },
            },
            required: ["nodeId"],
        },
    },
];
function parseToolInput(schema, value) {
    const parsed = schema.safeParse(value ?? {});
    if (!parsed.success)
        throw new Error(`invalid arguments: ${parsed.error.message}`);
    return parsed.data;
}
function text(value) {
    return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function createCanvasServer() {
    const server = new Server({ name: "canvas", version: PLUGIN_VERSION }, {
        capabilities: { tools: {} },
        instructions: "画布工具：先 canvas_apply 建节点，再 canvas_request_generation 排意图并立即返回；结果由宿主 worker 异步写回，需要时用 canvas_read 读取。",
    });
    server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }));
    server.setRequestHandler("tools/call", async (request) => {
        const name = request.params.name;
        const args = (request.params.arguments ?? {});
        try {
            if (name === "canvas_list_boards") {
                const workspace = resolveWorkspace(parseToolInput(workspaceSchema, args.workspace));
                return text({ boards: await listBoards(workspace) });
            }
            if (name === "canvas_read") {
                const parsed = parseToolInput(z.object({ board: z.string().optional(), workspace: workspaceSchema }), args);
                return text(await readBoard(resolveWorkspace(parsed.workspace), parsed.board));
            }
            if (name === "canvas_apply") {
                const parsed = parseToolInput(z.object({
                    board: z.string().optional(),
                    workspace: workspaceSchema,
                    operations: operationsSchema,
                }), args);
                return text(await applyOperations(resolveWorkspace(parsed.workspace), parsed.operations, parsed.board));
            }
            if (name === "canvas_request_generation") {
                const parsed = parseToolInput(z.object({
                    board: z.string().optional(),
                    workspace: workspaceSchema,
                    nodeId: z.string().min(1),
                    prompt: z.string().min(1),
                    size: z.string().min(1).optional(),
                    ratio: z.string().min(1).optional(),
                    seconds: z.string().min(1).optional(),
                    model: z.string().min(1).optional(),
                    firstFrame: z.string().min(1).optional(),
                }), args);
                const { nodeId, board, workspace, ...input } = parsed;
                return text(await requestGeneration(resolveWorkspace(workspace), nodeId, requestSchema.parse(input), board));
            }
            if (name === "canvas_cancel_generation") {
                const parsed = parseToolInput(z.object({
                    board: z.string().optional(),
                    workspace: workspaceSchema,
                    nodeId: z.string().min(1),
                }), args);
                return text(await cancelGeneration(resolveWorkspace(parsed.workspace), parsed.nodeId, parsed.board));
            }
            return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `${PLUGIN_NAME}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
serveStdio(createCanvasServer, { legacy: "reject" });
