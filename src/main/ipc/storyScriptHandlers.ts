import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  StoryScriptImportFile,
  StoryScriptSaveTemplateRequest,
  StoryScriptSaveTemplateResponse,
  StoryScriptSelectImportFileRequest
} from "@shared/ipc/contracts";
import {
  getStoryScriptTemplate,
  getStoryScriptTemplateFileName,
  resolveStoryScriptDocumentFormat
} from "@shared/storyScriptDocuments";

const MAX_STORY_SCRIPT_FILE_SIZE = 2 * 1024 * 1024;

export const registerStoryScriptHandlers = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.STORY_SCRIPT_SELECT_IMPORT_FILE,
    async (
      event,
      request: StoryScriptSelectImportFileRequest
    ): Promise<StoryScriptImportFile | null> => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: "导入分镜脚本",
        buttonLabel: "导入",
        defaultPath: request.defaultPath,
        properties: ["openFile"],
        filters: [
          { name: "分镜脚本", extensions: ["md", "markdown", "csv"] },
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "CSV", extensions: ["csv"] }
        ]
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const filePath = result.filePaths[0];
      const format = resolveStoryScriptDocumentFormat(filePath);
      if (!format) {
        throw new Error("仅支持导入 .md、.markdown 或 .csv 文件");
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error("请选择一个分镜脚本文件");
      }
      if (fileStat.size > MAX_STORY_SCRIPT_FILE_SIZE) {
        throw new Error("分镜脚本文件不能超过 2 MB");
      }

      return {
        filePath,
        fileName: basename(filePath),
        format,
        content: await readFile(filePath, "utf8")
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.STORY_SCRIPT_SAVE_TEMPLATE,
    async (
      event,
      request: StoryScriptSaveTemplateRequest
    ): Promise<StoryScriptSaveTemplateResponse | null> => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const templateFileName = getStoryScriptTemplateFileName(request.format);
      const options: Electron.SaveDialogOptions = {
        title: `另存${request.format === "markdown" ? " Markdown" : " CSV"} 模板`,
        buttonLabel: "保存模板",
        defaultPath: request.defaultPath
          ? join(request.defaultPath, templateFileName)
          : templateFileName,
        filters:
          request.format === "markdown"
            ? [{ name: "Markdown", extensions: ["md"] }]
            : [{ name: "CSV", extensions: ["csv"] }]
      };
      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return null;
      }

      const template = getStoryScriptTemplate(request.format);
      await writeFile(
        result.filePath,
        request.format === "csv" ? `\uFEFF${template}` : template,
        "utf8"
      );

      return { filePath: result.filePath };
    }
  );
};
