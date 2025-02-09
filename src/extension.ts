import * as vscode from "vscode";
import fs from "fs/promises";
import {ELogLevel} from "./e-log-level";
import {existsSync} from "fs";
import { extname, join, parse } from "path";

let channel: vscode.OutputChannel = vscode.window.createOutputChannel("LazyArmaDev");

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
 * @param {boolean} useExternal (default, false) Use QPATHTOEF macro
 */
async function copyPath(macroPath: string, useExternal: boolean = false) {
    const match = macroPath.match(addonRegex);
    if (!match) { return; }

    logMessage(ELogLevel.TRACE, `macroPath=${macroPath}, match=${match}`);
    const macroPathArray = match![1].split("\\");
    const componentName = macroPathArray.shift();

    if (useExternal) {
        macroPath = `QPATHTOEF(${componentName},${join(...macroPathArray)})`;
    } else {
        macroPath = `QPATHTOF(${join(...macroPathArray)})`;
    }

    logMessage(ELogLevel.INFO, `Copied path to clipboard: ${macroPath}`);
    await vscode.window.showInformationMessage(`Copied ${macroPath} path to clipboard`);
    await vscode.env.clipboard.writeText(macroPath);
}

/**
 * Adds a translation key to the given .xml file
 * @param {String} filePath The path to the stringtable.xml file
 * @param {String} stringKey The translation key
 */
async function addStringTableKey(filePath: string, stringKey: string) {
    const content = (await fs.readFile(filePath, {encoding: "utf-8", flag: "r"})).split("\n");

    const newKey = `        <Key ID="${stringKey}">
            <English></English>
        </Key>`;
    content.splice(content.length - 2, 0, newKey);

    try {
        await fs.writeFile(filePath, content.join("\n"));
        await vscode.window.showInformationMessage(`Generated stringtable key for ${stringKey}`);
    } catch (err) {
        await vscode.window.showErrorMessage(`Failed to write to stringtable file at ${filePath}`);
    }
}

/**
 * Returns the various "prefixes" for the mod / addon
 */
async function getProjectPrefix() {
    const filePath = vscode.window.activeTextEditor?.document.fileName;
    if (!filePath) {
        return { mainPrefix: "", prefix: "", component: "" };
    }

    const addonDir = filePath!.match(addonDiskRegex);
    if (!addonDir) {
        return { mainPrefix: "", prefix: "", component: "" };
    }

    const addonDirArray = addonDir[0].split("\\");
    const component = addonDirArray[addonDirArray.length - 1];

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
        await copyPath(join(...path), true);
    });
    context.subscriptions.push(copyExternalMacroPath);

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

        files = files.map(file => {
            let functionName = parse(file).name; // Remove extension
            functionName = (functionName.split("_").splice(1)).join("_"); // Remove fn_ / fnc_ prefix
            return `PREP(${functionName});`;
        });

        const content = files.join("\n");

        logMessage(ELogLevel.TRACE, `content=${content}`);
        files.sort();

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

        const projectPrefix = await getProjectPrefix();
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
                vscode.window.showInformationMessage(`Automatically generated missing stringtable.xml file`);
                await addStringTableKey(stringtableDir, stringKey);
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