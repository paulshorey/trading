export const qsObjectToString = (qsObject: Record<string, string>) => Object.entries(qsObject).join("&").replaceAll(",", "=");
