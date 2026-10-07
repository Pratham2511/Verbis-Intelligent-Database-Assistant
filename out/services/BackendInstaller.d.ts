/**
 * BackendInstaller — auto-creates a Python venv and installs backend deps.
 *
 * Design:
 * - Venv stored in context.globalStorageUri (SURVIVES extension updates)
 * - Cross-platform Python path detection (Windows + Linux/Mac)
 * - Uses uv for 10x faster installs, falls back to pip
 * - "Install Now / Later" dialog UX
 * - "verbis.installBackend" reinstall command
 * - Marker file (verbis_ready) for reliable state tracking
 */
import * as vscode from 'vscode';
export declare class BackendInstaller {
    private readonly context;
    private installing?;
    constructor(context: vscode.ExtensionContext);
    private get storageDir();
    private get venvDir();
    private get markerFile();
    get pythonExe(): string;
    private get pipExe();
    private get uvExe();
    isReady(): boolean;
    private markReady;
    private runCommand;
    private getSystemPython;
    install(progress: vscode.Progress<{
        message?: string;
        increment?: number;
    }>): Promise<void>;
    installWithProgress(): Promise<void>;
}
