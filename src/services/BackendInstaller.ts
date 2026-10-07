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
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';


export class BackendInstaller {

    private installing?:Thenable<void>;

    constructor(private readonly context: vscode.ExtensionContext) {}

    private get storageDir(): string {
        const dir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        return dir;
    }

    private get venvDir(): string {
        try {const manifest=JSON.parse(fs.readFileSync(path.join(this.storageDir,'active-backend.json'),'utf8'));
          if(typeof manifest.directory==='string' && /^venv-[a-f0-9-]+$/.test(manifest.directory)) return path.join(this.storageDir,manifest.directory);
        } catch {}
        return path.join(this.storageDir, 'venv');
    }

    private get markerFile(): string {
        return path.join(this.venvDir, 'verbis_ready');
    }

    get pythonExe(): string {
        return process.platform === 'win32'
            ? path.join(this.venvDir, 'Scripts', 'python.exe')
            : path.join(this.venvDir, 'bin', 'python3');
    }

    private get pipExe(): string {
        return process.platform === 'win32'
            ? path.join(this.venvDir, 'Scripts', 'pip.exe')
            : path.join(this.venvDir, 'bin', 'pip3');
    }

    private get uvExe(): string {
        return process.platform === 'win32'
            ? path.join(this.venvDir, 'Scripts', 'uv.exe')
            : path.join(this.venvDir, 'bin', 'uv');
    }

    isReady(): boolean {
        try{const manifest=JSON.parse(fs.readFileSync(path.join(this.storageDir,'active-backend.json'),'utf8'));
          const requirements=fs.readFileSync(path.join(this.context.extensionPath,'python_backend','requirements.txt'));
          if(manifest.requirementsHash!==crypto.createHash('sha256').update(requirements).digest('hex'))return false;
        }catch{return false}
        return fs.existsSync(this.markerFile) && fs.existsSync(this.pythonExe);
    }

    private markReady(): void {
        fs.writeFileSync(this.markerFile, new Date().toISOString(), 'utf-8');
    }

    private runCommand(exe: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn(exe, args, { stdio: 'pipe' });
            let stderr = '';
            proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`${path.basename(exe)} failed (exit ${code}): ${stderr.slice(0, 300)}`)); }
            });
            proc.on('error', (e) => reject(new Error(`Cannot run ${exe}: ${e.message}`)));
        });
    }

    private async getSystemPython(): Promise<string> {
        const candidates = process.platform === 'win32'
            ? ['python', 'python3']
            : ['python3', 'python'];

        for (const cmd of candidates) {
            try {
                await this.runCommand(cmd, ['-c', 'import sys; assert (3,11) <= sys.version_info[:2] < (3,14), "Python 3.11–3.13 required"']);
                return cmd;
            } catch { continue; }
        }
        throw new Error(
            'Python 3.11–3.13 is required but was not found. ' +
            'Install it from python.org and restart VS Code.'
        );
    }

    async install(
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        const reqFile = path.join(
            this.context.extensionPath, 'python_backend', 'requirements.txt'
        );

        // Guard: requirements.txt MUST exist in the extension folder.
        // If it's missing, the .vsix was packaged without it (older builds
        // excluded python_backend/** entirely). Surface a clear error instead
        // of letting uv fail with a cryptic "File not found" message.
        if (!fs.existsSync(reqFile)) {
            throw new Error(
                `requirements.txt not found at ${reqFile}. ` +
                `The extension may have been packaged incorrectly. ` +
                `Please reinstall Verbis from the VS Code Marketplace, or ` +
                `report this issue at https://github.com/Pratham2511/Verbis-Intelligent-Database-Assistant/issues.`
            );
        }


        progress.report({ message: 'Checking Python installation...', increment: 5 });
        const sysPython = await this.getSystemPython();

        // Build in a fresh, permanent path. A failed install never alters the working environment.
        const directory='venv-'+crypto.randomUUID();
        const staged=path.join(this.storageDir,directory);
        const bin=path.join(staged,process.platform==='win32'?'Scripts':'bin');
        const python=path.join(bin,process.platform==='win32'?'python.exe':'python3');
        const pip=path.join(bin,process.platform==='win32'?'pip.exe':'pip3');
        const uv=path.join(bin,process.platform==='win32'?'uv.exe':'uv');
        try {
          progress.report({ message: 'Creating Python environment...', increment: 15 });
          await this.runCommand(sysPython,['-m','venv',staged]);
          progress.report({ message: 'Installing package manager...', increment: 10 });
          await this.runCommand(pip,['install','--quiet','uv']).catch(()=>{});
          progress.report({ message: 'Installing pinned dependencies...', increment: 50 });
          await this.runCommand(fs.existsSync(uv)?uv:pip,fs.existsSync(uv)?['pip','install','--python',python,'-r',reqFile,'--quiet']:['install','-r',reqFile,'--quiet']);
          progress.report({message:'Checking backend imports...',increment:15});
          await this.runCommand(python,['-c','import fastapi, uvicorn, sqlalchemy, sqlglot, cryptography, openai, pydantic_settings']);
          fs.writeFileSync(path.join(staged,'verbis_ready'),new Date().toISOString());
          const manifest=path.join(this.storageDir,'active-backend.json');
          fs.writeFileSync(manifest+'.tmp',JSON.stringify({directory,requirementsHash:crypto.createHash('sha256').update(fs.readFileSync(reqFile)).digest('hex')}));
          fs.renameSync(manifest+'.tmp',manifest);
        } catch (err) {
          fs.rmSync(staged,{recursive:true,force:true});
          throw err;
        }
        progress.report({ message: '✅ Verbis backend ready!', increment: 5 });
    }

    async installWithProgress(): Promise<void> {
        if(this.installing)return this.installing;
        const task=vscode.window.withProgress(
            {location:vscode.ProgressLocation.Notification,title:'Setting up Verbis Backend',cancellable:false},
            progress=>this.install(progress)
        );
        this.installing=task;
        try{await task}finally{if(this.installing===task)this.installing=undefined}
    }

}
