import { existsSync, readFileSync } from 'node:fs';

/** Never include a startup-initialized plugin with missing native resources. */
export function hasAndroidFirebaseConfig(file: string, packageName: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const client = Array.isArray(config.client) && config.client.find((item: { client_info?: { android_client_info?: { package_name?: unknown } } }) =>
      item?.client_info?.android_client_info?.package_name === packageName);
    if (typeof config.project_info?.project_id !== 'string' || !config.project_info.project_id.trim() ||
      typeof client?.client_info?.mobilesdk_app_id !== 'string' || !client.client_info.mobilesdk_app_id.includes(':android:') ||
      !Array.isArray(client?.api_key) || !client.api_key.some((key: { current_key?: unknown }) => typeof key?.current_key === 'string' && key.current_key.trim())) throw new Error();
    return true;
  } catch {
    throw new Error(`google-services.json no es válido para ${packageName}. Descarga el archivo de la aplicación Android correcta desde Firebase antes de sincronizar.`);
  }
}
