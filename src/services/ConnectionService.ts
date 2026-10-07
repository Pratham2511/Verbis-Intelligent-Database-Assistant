import {BackendClient} from './BackendClient';
import {WorkspaceService} from './WorkspaceService';
import {SecretsService} from './SecretsService';
import {DBConfig} from '../types';
export async function saveConnection(client:BackendClient,workspace:WorkspaceService,secrets:SecretsService,connection:DBConfig,password:string){
 const old=(await workspace.readConfig()).connections.find(c=>c.id===connection.id);
 const oldPassword=connection.dialect==='sqlite'?undefined:await secrets.getDbPassword(connection.id);
 const effectivePassword=password||oldPassword||'';
 await client.registerConnection(connection,effectivePassword,true);
 try{
  if(connection.dialect!=='sqlite'&&password)await secrets.storeDbPassword(connection.id,password);
  await client.registerConnection(connection,effectivePassword);
  await workspace.upsertConnection(connection);
 }catch(error){
  // Restore the previous working connection if persistence or final registration fails.
  try{if(old)await client.registerConnection(old,oldPassword||'');else await client.deleteConnection(connection.id);
   if(password&&connection.dialect!=='sqlite'){if(oldPassword)await secrets.storeDbPassword(connection.id,oldPassword);else await secrets.deleteDbPassword(connection.id);}
  }catch{ /* The original actionable failure remains visible. */ }
  throw error;
 }
}
