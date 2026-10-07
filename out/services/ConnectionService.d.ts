import { BackendClient } from './BackendClient';
import { WorkspaceService } from './WorkspaceService';
import { SecretsService } from './SecretsService';
import { DBConfig } from '../types';
export declare function saveConnection(client: BackendClient, workspace: WorkspaceService, secrets: SecretsService, connection: DBConfig, password: string): Promise<void>;
