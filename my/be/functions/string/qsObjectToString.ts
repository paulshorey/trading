export function qsObjectToString(qsObject: Record<string, string>) {
  return (Object.entries(qsObject).join("&").replaceAll(",", "=") + "&").replace(/=&/g, "&").replace(/&$/, "");
}
