import * as vscode from "vscode";
import fs from "fs/promises";
import { ELogLevel } from "./e-log-level";
import { PathType } from "./path-type";
import { existsSync } from "fs";
import { extname, join, parse } from "path";

let channel: vscode.OutputChannel = vscode.window.createOutputChannel("LazyArmaDev");

/*
 Important notes:
 A showXMessage function should always be the last line.
 These return an awaitable state that resolves when the window of that message disapears, so any lines after may not run.
 */

/**
 * Logs a message to the debug console
 * @param {String} level Log level, e.g. TRACE, INFO, WARN, ERROR
 * @param {String} message The message to log
 */
function logMessage(level: ELogLevel, message: string) {
    channel.appendLine(`[${level.padEnd(5)}]: ${message}`);
}

// Used to get the path to something inside the component folder
const addonRegex = /addons\\(.*)/;

// Used to get the path on disk to the component
const addonDiskRegex = /.*\\addons\\[^\\]*/;

/**
 * Copies the "macro'd" path to a file using the QPATHTOF / QPATHTOEF macros
 * @param {string} macroPath The path to the given file or folder
 * @param {PathType} pathType The type of path to copy
 */
async function copyPath(path: string, pathType: PathType = PathType.MACRO) {
    const match = path.match(addonRegex);
    if (!match) { return; }

    logMessage(ELogLevel.TRACE, `path=${path}, match=${match}`);
    const pathArray = match![1].split("\\");
    const componentName = pathArray.shift();

    switch (pathType) {
        case PathType.MACRO: {
            path = `QPATHTOF(${join(...pathArray)})`;
            break;
        }
        case PathType.MACRO_EXTERNAL: {
            path = `QPATHTOEF(${componentName},${join(...pathArray)})`;
            break;
        }
        case PathType.RESOLVED: {
            const projectPrefix = await getProjectPrefix(path);
            path = `${projectPrefix.mainPrefix}\\${projectPrefix.prefix}\\addons\\${projectPrefix.component}\\${join(...pathArray)}`;
            break;
        }
    }

    logMessage(ELogLevel.INFO, `Copied path to clipboard: ${path}`);
    await vscode.env.clipboard.writeText(path);
    await vscode.window.showInformationMessage(`Copied ${path} path to clipboard`);
}

/**
 * Adds a translation key to the given .xml file
 * @param {String} filePath The path to the stringtable.xml file
 * @param {String} stringKey The translation key
 */
async function addStringTableKey(filePath: string, stringKey: string) {
    let content = (await fs.readFile(filePath, {encoding: "utf-8", flag: "r"})).split("\n");
    const hasTrailingNewline = content.at(-1) === "";
    let spliceEnd = 2;
    if (hasTrailingNewline) { spliceEnd = 3; }

    const newKey = `        <Key ID="${stringKey}">
            <English></English>
        </Key>`;
    content.splice(content.length - spliceEnd, 0, newKey);

    try {
        // Only add trailing newline if setting is enabled and there is not already a newline
        let config = vscode.workspace.getConfiguration("files");
        if (!hasTrailingNewline && config.get("insertFinalNewline", false)) {
            content.push("");
        }
        await fs.writeFile(filePath, content.join("\n"));
        await vscode.window.showInformationMessage(`Generated stringtable key for ${stringKey}`, "Open File")
            .then((selection: string | undefined) => {
                if (!selection) { return; }
                if (selection === "Open File") {
                    vscode.window.showTextDocument(vscode.Uri.file(filePath));
                }
            });
    } catch (err) {
    }
}

/**
 * Returns the various "prefixes" for the mod / addon
 */
async function getProjectPrefix(filePath: string | undefined = "") {
    // Default for if there's no given path, since there's not always an editor (file) open
    if (!filePath || filePath === "") {
        filePath = vscode.window.activeTextEditor?.document.fileName;
    }

    const addonDir = filePath!.match(addonDiskRegex);
    if (!addonDir) {
        return { mainPrefix: "", prefix: "", component: "" };
    }

    const addonDirArray = addonDir[0].split("\\");
    const component = addonDirArray[addonDirArray.length - 1];

    if (!existsSync(`${addonDir}\\$PBOPREFIX$`)) {
        return { mainPrefix: "NOT_FOUND", prefix: "NOT_FOUND", component: "NOT_FOUND" };
    }

    // Read $PBOPREFIX$ file to get main prefix and prefix
    const prefixContent = (await fs.readFile(`${addonDir}\\$PBOPREFIX$`, {encoding: "utf-8", flag: "r"})).split("\\");
    const mainPrefix = prefixContent[0];
    const prefix = prefixContent[1];

    return { mainPrefix, prefix, component };
}

/*
 * Command function usage
 * Use registerTextEditorCommand if the command only uses the active editor / file.
 * If the command uses a different editor or file, use registerCommand with the editor argument.
 */

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context: vscode.ExtensionContext) {
    // Custom when clause for when the "Generate Stringtable Key" command should be shown
    vscode.window.onDidChangeTextEditorSelection(async (event) => {
        if (!event.kind) { return; }

        const document = vscode.window.activeTextEditor?.document;
        if (!document) { return; }
        const position = event.selections[0].anchor;

        // Get the previous word, rather than where the cursor is
        let selectedWord = document.getText(document.getWordRangeAtPosition(position));

        const newCharacter = position.character - selectedWord.length;
        if (newCharacter <= 0) {
            await vscode.commands.executeCommand("setContext", "LazyArmaDev.selectedStringtableMacro", false);
            return;
        }

        const macroStart = new vscode.Position(position.line, newCharacter);

        selectedWord = document.getText(document.getWordRangeAtPosition(macroStart));
        logMessage(ELogLevel.TRACE, `selectedWord=${selectedWord}, ${selectedWord.endsWith("STRING")}`);
        await vscode.commands.executeCommand("setContext", "LazyArmaDev.selectedStringtableMacro", selectedWord.endsWith("STRING")); // CSTRING, LSTRING, LLSTRING, etc.
    });

    const copyMacroPath = vscode.commands.registerCommand("lazyarmadev.copyMacroPath", async (editor) => {
        if (!editor) { return; }
        let path = editor.path.split("/");
        path.shift();
        await copyPath(join(...path));
    });
    context.subscriptions.push(copyMacroPath);

    const copyExternalMacroPath = vscode.commands.registerCommand("lazyarmadev.copyExternalMacroPath", async (editor) => {
        if (!editor) { return; }
        let path = editor.path.split("/");
        path.shift();
        await copyPath(join(...path), PathType.MACRO_EXTERNAL);
    });
    context.subscriptions.push(copyExternalMacroPath);

    const copyResolvedPath = vscode.commands.registerCommand("lazyarmadev.copyResolvedPath", async (editor) => {
        if (!editor) { return; }
        let path = editor.path.split("/");
        path.shift();
        await copyPath(join(...path), PathType.RESOLVED);
    });
    context.subscriptions.push(copyResolvedPath);

    const generatePrepFile = vscode.commands.registerCommand("lazyarmadev.generatePrepFile", async (editor) => {
        if (!editor) { return; }
        let functionsFolderArray = editor.path.split("/");
        functionsFolderArray.shift();
        logMessage(ELogLevel.TRACE, `functionsFolderArray=[${functionsFolderArray}]`);
        const functionsFolder = join(...functionsFolderArray, "");

        logMessage(ELogLevel.INFO, `Generating PREP file for "${functionsFolder}"`);
        let files = await fs.readdir(functionsFolder);

        // Only PREP sqf files
        files = files.filter((file) => extname(file.toLowerCase()) === ".sqf");

        files.sort();
        files = files.map(file => {
            let functionName = parse(file).name; // Remove extension
            functionName = (functionName.split("_").splice(1)).join("_"); // Remove fn_ / fnc_ prefix
            return `PREP(${functionName});`;
        });

        let content = files.join("\n");
        let config = vscode.workspace.getConfiguration("files");
        if (config.get("insertFinalNewline", false)) {
            content += "\n";
        }
        logMessage(ELogLevel.TRACE, `content=${content}`);

        functionsFolderArray.pop(); // Remove "functions", XEH_PREP should be in addon root
        const prepFileDir = join(...functionsFolderArray, "XEH_PREP.hpp");
        try {
            await fs.writeFile(prepFileDir, content);
            await vscode.window.showInformationMessage(`Generated XEH_PREP.hpp file for ${files.length} functions`);
        } catch (err) {
            await vscode.window.showErrorMessage(`Failed to create file at ${prepFileDir}`);
        }
    });
    context.subscriptions.push(generatePrepFile);

    const generateStringtableKey = vscode.commands.registerTextEditorCommand("lazyarmadev.generateStringtableKey", async (textEditor: vscode.TextEditor) =>  {
        if (!textEditor) { return; }
        const document = textEditor.document;
        const match = document!.fileName.match(addonDiskRegex);

        const stringtableDir = `${match![0]}\\stringtable.xml`;
        logMessage(ELogLevel.TRACE, `stringtableDir=${stringtableDir}`);

        const projectPrefix = await getProjectPrefix(document.fileName);
        let stringKey = document!.getText(document!.getWordRangeAtPosition(textEditor!.selection.active));
        stringKey = `STR_${projectPrefix.prefix}_${projectPrefix.component}_${stringKey}`;
        logMessage(ELogLevel.TRACE, `stringKey="${stringKey}"`);

        // File doesn't exist, so create a "blank" stringtable
        if (!existsSync(stringtableDir)) {
            logMessage(ELogLevel.TRACE, "No stringtable.xml found, creating blank file");
            const content = `<?xml version="1.0" encoding="utf-8"?>
<Project name="${projectPrefix.prefix.toUpperCase()}">
    <Package name="${projectPrefix.component}">
    </Package>
</Project>`;
            try {
                await fs.writeFile(stringtableDir, content);
                await addStringTableKey(stringtableDir, stringKey);
                vscode.window.showInformationMessage(`Automatically generated missing stringtable.xml file`);
            } catch (err) {
                await vscode.window.showErrorMessage(`Failed to create missing stringtable file at ${stringtableDir}`);
            }
        } else {
            await addStringTableKey(stringtableDir, stringKey);
        }
    });
    context.subscriptions.push(generateStringtableKey);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};