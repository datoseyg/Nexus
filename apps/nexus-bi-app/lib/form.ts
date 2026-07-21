// @/lib/utils/form (o donde prefieras ubicar tus utilidades)
export function formString(formData: FormData, key: string, maxLength: number): string {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}