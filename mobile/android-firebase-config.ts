import { existsSync, readFileSync } from 'node:fs';

const projectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** Validate native resources and expose only the public project identifier. */
export function readAndroidFirebaseProjectId(file: string, packageName: string): string | null {
  if (!existsSync(file)) return null;
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const client = Array.isArray(config.client) && config.client.find((item: { client_info?: { android_client_info?: { package_name?: unknown } } }) =>
      item?.client_info?.android_client_info?.package_name === packageName);
    const projectId = config.project_info?.project_id;
    if (typeof projectId !== 'string' || !projectIdPattern.test(projectId) ||
      typeof client?.client_info?.mobilesdk_app_id !== 'string' || !client.client_info.mobilesdk_app_id.includes(':android:') ||
      !Array.isArray(client?.api_key) || !client.api_key.some((key: { current_key?: unknown }) => typeof key?.current_key === 'string' && key.current_key.trim()) ||
      !Array.isArray(client?.oauth_client) || !client.oauth_client.some((oauth: { client_type?: unknown; client_id?: unknown }) =>
        oauth?.client_type === 3 && typeof oauth.client_id === 'string' && oauth.client_id.trim())) throw new Error();
    return projectId;
  } catch {
    throw new Error(`google-services.json no es válido para ${packageName}. Descarga el archivo de la aplicación Android correcta desde Firebase antes de sincronizar.`);
  }
}

/** Never include a startup-initialized plugin with missing native resources. */
export function hasAndroidFirebaseConfig(file: string, packageName: string): boolean {
  return readAndroidFirebaseProjectId(file, packageName) !== null;
}
