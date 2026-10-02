/**
 * Saves a file from the app. On iPhone the share sheet offers "Save to Files", which is the most
 * reliable option; elsewhere it downloads. Must be called straight from a tap (the share sheet needs
 * it), so do slow work before showing the button that calls this.
 */
export async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
