import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { ApiError, authHeaders } from "../api";

/** Downloads an authenticated export and opens the share sheet (save to Files, WhatsApp, email…). */
export async function downloadAndShare(url: string, fileName: string, mimeType: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) throw new ApiError(0, "Sharing is not available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName });
}
